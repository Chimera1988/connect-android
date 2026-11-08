/** Connect PWA parity: audio-only calls, contacts picker, realtime journal and editing. */
import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,AppState,FlatList,Image,Modal,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {db,type Call,type Profile} from './backend';
import type {Palette} from './theme';

const CALL_COLUMNS='id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at';
type JournalSetting={owner_id:string;cleared_before:string|null;hidden_ids:string[]};
type Filter='all'|'missed';
const settingsDefault=(id:string):JournalSetting=>({owner_id:id,cleared_before:null,hidden_ids:[]});
const isMissed=(row:Call,selfId:string)=>row.callee_id===selfId&&(
  row.status==='missed'||row.status==='declined'||
  (row.status==='ended'&&!row.answered_at)||
  (row.status==='ringing'&&Date.now()-Date.parse(row.created_at)>60000)
);
const dateOf=(iso:string)=>new Date(iso).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const timeOf=(iso:string)=>new Date(iso).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
function statusText(row:Call,ownerId:string){
  const out=row.caller_id===ownerId;
  const prefix=out?'Исходящий':'Входящий';
  if(row.status==='active')return `${prefix} · идёт разговор`;
  if(row.status==='ringing'&&Date.now()-Date.parse(row.created_at)<=60000)return `${prefix} · вызов`;
  if(isMissed(row,ownerId))return 'Пропущенный';
  if(row.status==='declined')return out?'Исходящий · отклонён':'Отклонённый';
  if(row.status==='busy')return `${prefix} · занято`;
  if(row.status==='failed')return `${prefix} · соединение не удалось`;
  if(!row.answered_at)return `${prefix} · без ответа`;
  if(!row.ended_at)return prefix;
  const seconds=Math.max(0,Math.round((Date.parse(row.ended_at)-Date.parse(row.answered_at))/1000));
  return `${prefix} · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
function IconButton({icon,label,colors,onPress,disabled}:{icon:keyof typeof Ionicons.glyphMap;label:string;colors:Palette;onPress:()=>void;disabled?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}
    style={{minWidth:40,minHeight:40,alignItems:'center',justifyContent:'center',borderRadius:13,borderWidth:1,borderColor:colors.line,backgroundColor:colors.elevated,opacity:disabled ? 0.4 : 1}}>
    <Ionicons name={icon} size={21} color={colors.accent}/>
  </Pressable>;
}
function Avatar({name,url,colors,size=43}:{name:string;url?:string;colors:Palette;size?:number}){
  return <View style={{height:size,width:size,borderRadius:size/2,backgroundColor:colors.elevated,borderColor:colors.line,borderWidth:1,alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
    {url?<Image source={{uri:url}} style={{width:size,height:size}}/>:<Text style={{fontWeight:'700',color:colors.accent,fontSize:size*.40}}>{(name||'C').trim().slice(0,1).toUpperCase()}</Text>}
  </View>;
}
export default function ConnectNativeCalls({ownerId,profiles,avatars,colors,onDial}:{ownerId:string;profiles:Profile[];avatars:Record<string,string>;colors:Palette;onDial?:(conversationId:string,peer:Profile)=>void}){
  const [rows,setRows]=useState<Call[]>([]);
  const [settings,setSettings]=useState<JournalSetting>(settingsDefault(ownerId));
  const [filter,setFilter]=useState<Filter>('all');
  const [selectionMode,setSelectionMode]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [showMenu,setShowMenu]=useState(false);
  const [pickerOpen,setPickerOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const reload=useCallback(async()=>{
    if(!ownerId)return;
    const [callsResult,prefsResult]=await Promise.all([
      db.from('connect_calls').select(CALL_COLUMNS).or(`caller_id.eq.${ownerId},callee_id.eq.${ownerId}`).order('created_at',{ascending:false}).limit(150),
      db.from('connect_call_journal_settings').select('owner_id,cleared_before,hidden_ids').eq('owner_id',ownerId).maybeSingle(),
    ]);
    if(callsResult.error||prefsResult.error)setError(callsResult.error?.message||prefsResult.error?.message||'Не удалось загрузить журнал');
    else {
      setRows((callsResult.data||[]) as Call[]);
      const saved=prefsResult.data as JournalSetting|null;
      setSettings(saved?{...saved,hidden_ids:Array.isArray(saved.hidden_ids)?saved.hidden_ids:[]}:settingsDefault(ownerId));
      setError('');
    }
    setLoading(false);
  },[ownerId]);
  useEffect(()=>{
    let alive=true;
    setLoading(true);setSettings(settingsDefault(ownerId));setRows([]);setSelected([]);setSelectionMode(false);
    void reload();
    const timer=setInterval(()=>{if(alive)void reload();},18000);
    const listener=AppState.addEventListener('change',state=>{if(state==='active'&&alive)void reload();});
    const channel=db.channel(`connect-native-journal-${ownerId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'connect_calls',filter:`caller_id=eq.${ownerId}`},()=>{if(alive)void reload();})
      .on('postgres_changes',{event:'*',schema:'public',table:'connect_calls',filter:`callee_id=eq.${ownerId}`},()=>{if(alive)void reload();})
      .on('postgres_changes',{event:'*',schema:'public',table:'connect_call_journal_settings',filter:`owner_id=eq.${ownerId}`},()=>{if(alive)void reload();})
      .subscribe();
    return()=>{alive=false;clearInterval(timer);listener.remove();void db.removeChannel(channel);};
  },[ownerId,reload]);
  const visible=useMemo(()=>rows.filter(row=>
    !(settings.cleared_before&&Date.parse(row.created_at)<=Date.parse(settings.cleared_before))&&
    !settings.hidden_ids.includes(row.id)
  ),[rows,settings]);
  const display=useMemo(()=>filter==='missed'?visible.filter(row=>isMissed(row,ownerId)):visible,[filter,visible,ownerId]);
  const contacts=useMemo(()=>profiles.filter(p=>!p.is_blocked&&p.id!==ownerId&&p.display_name.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')))
    .sort((a,b)=>a.display_name.localeCompare(b.display_name,'ru')),[profiles,ownerId,search]);
  async function startAudio(peer:Profile,conversationId?:string|null){
    if(busy||!onDial)return;
    setBusy(true);setError('');
    try{
      let id=conversationId;
      if(!id){
        const [user_a,user_b]=[ownerId,peer.id].sort();
        const result=await db.from('conversations').upsert({user_a,user_b},{onConflict:'user_a,user_b'}).select('id').single();
        if(result.error||!result.data?.id)throw result.error||new Error('Не удалось создать переписку');
        id=result.data.id as string;
      }
      setPickerOpen(false);setSearch('');
      onDial(id,peer);
    }catch(e){setError('Не удалось начать звонок: '+(e instanceof Error?e.message:String(e)));}
    finally{setBusy(false);}
  }
  function stopSelection(){setSelectionMode(false);setSelected([]);setShowMenu(false);}
  function removeSelected(){
    if(busy||!selected.length)return;
    const ids=[...selected];
    Alert.alert('Удалить записи?',`Удалить ${ids.length} записей только из вашего журнала?`,[
      {text:'Отмена',style:'cancel'},
      {text:'Удалить',style:'destructive',onPress:()=>void (async()=>{
        setBusy(true);setError('');
        try{
          const next={...settings,owner_id:ownerId,hidden_ids:Array.from(new Set([...settings.hidden_ids,...ids]))};
          const result=await db.from('connect_call_journal_settings').upsert({...next,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
          if(result.error)throw result.error;
          setSettings(next);stopSelection();
        }catch(e){setError('Не удалось удалить: '+(e instanceof Error?e.message:String(e)));}
        finally{setBusy(false);}
      })()},
    ]);
  }
  function clearAll(){
    if(!visible.length||busy)return;
    Alert.alert('Очистить журнал?', 'Записи исчезнут только у вас. У собеседников история сохранится.',[
      {text:'Отмена',style:'cancel'},
      {text:'Очистить',style:'destructive',onPress:()=>void (async()=>{
        setBusy(true);setError('');
        try{
          const now=new Date().toISOString();
          const next={...settings,owner_id:ownerId,cleared_before:now};
          const result=await db.from('connect_call_journal_settings').upsert({...next,updated_at:now},{onConflict:'owner_id'});
          if(result.error)throw result.error;
          setSettings(next);stopSelection();
        }catch(e){setError('Не удалось очистить: '+(e instanceof Error?e.message:String(e)));}
        finally{setBusy(false);}
      })()},
    ]);
  }
  const chip=(label:string,action:()=>void,active=false,disabled=false)=><Pressable accessibilityRole="button" accessibilityState={{selected:active,disabled}} onPress={action} disabled={disabled}
    style={{paddingHorizontal:14,paddingVertical:9,borderRadius:16,borderWidth:1,borderColor:active?colors.accent:colors.line,backgroundColor:active?colors.accent:colors.surface,opacity:disabled ? 0.4 : 1}}>
    <Text style={{color:active?colors.bg:colors.text,fontSize:12,fontWeight:active?'700':'500'}}>{label}</Text></Pressable>;
  return <View style={{flex:1}}>
    <View style={{padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10}}>
      <View style={{flex:1}}><Text style={{color:colors.text,fontSize:27,fontWeight:'800'}}>Звонки</Text><Text style={{color:colors.muted,fontSize:12}}>{visible.length} записей</Text></View>
      <IconButton icon="call-outline" label="Новый аудиозвонок" colors={colors} onPress={()=>{setSearch('');setPickerOpen(true);setShowMenu(false);}} disabled={busy}/>
      <IconButton icon="ellipsis-horizontal" label="Действия с журналом" colors={colors} onPress={()=>setShowMenu(x=>!x)}/>
    </View>
    {showMenu&&<View style={{padding:10,marginHorizontal:14,marginBottom:9,borderColor:colors.line,borderWidth:1,borderRadius:16,backgroundColor:colors.surface,gap:6}}>
      {chip('Выбрать записи',()=>{setSelectionMode(true);setShowMenu(false);},false,busy)}
      {chip('Очистить журнал',()=>{setShowMenu(false);clearAll();},false,busy||!visible.length)}
    </View>}
    {selectionMode&&<View style={{flexDirection:'row',alignItems:'center',gap:7,paddingHorizontal:14,marginBottom:9,flexWrap:'wrap'}}>
      {chip(`Выбрано: ${selected.length}`,()=>{},false,true)}
      {chip('Выбрать все',()=>setSelected(display.map(row=>row.id)),false,busy||!display.length)}
      {chip('Удалить',removeSelected,false,busy||!selected.length)}
      {chip('Отмена',stopSelection,false,busy)}
    </View>}
    <View style={{flexDirection:'row',gap:8,paddingHorizontal:14,marginBottom:12}}>
      {chip('Все',()=>setFilter('all'),filter==='all')}
      {chip('Пропущенные',()=>setFilter('missed'),filter==='missed')}
    </View>
    {!!error&&<Pressable accessibilityRole="button" onPress={()=>void reload()} style={{padding:14}}><Text style={{color:colors.danger}}>{error} · Повторить</Text></Pressable>}
    {loading?<ActivityIndicator style={{marginTop:40}} color={colors.accent}/>:<FlatList data={display} keyExtractor={row=>row.id}
      contentContainerStyle={{paddingHorizontal:14,paddingBottom:28}}
      ListEmptyComponent={<Text style={{color:colors.muted,textAlign:'center',marginTop:50}}>{filter==='missed'?'Пропущенных звонков нет':'Звонков пока нет'}</Text>}
      renderItem={({item})=>{
        const outgoing=item.caller_id===ownerId;
        const peerId=outgoing?item.callee_id:item.caller_id;
        const peer=profiles.find(p=>p.id===peerId);
        const name=peer?.display_name||'Собеседник';
        const missed=isMissed(item,ownerId);
        const checked=selected.includes(item.id);
        const active=item.status==='ringing'||item.status==='active';
        return <View style={{backgroundColor:colors.surface,borderBottomWidth:1,borderColor:colors.line,padding:12,flexDirection:'row',alignItems:'center',gap:10}}>
          {selectionMode&&<Pressable onPress={()=>setSelected(x=>checked?x.filter(id=>id!==item.id):[...x,item.id])} accessibilityRole="checkbox" accessibilityState={{checked}}>
            <Ionicons name={checked?'checkbox':'square-outline'} color={colors.accent} size={24}/></Pressable>}
          <Avatar name={name} url={avatars[peerId]} colors={colors} size={46}/>
          <Pressable style={{flex:1,gap:4}} onPress={()=>{if(selectionMode)setSelected(x=>checked?x.filter(id=>id!==item.id):[...x,item.id]);}}>
            <Text numberOfLines={1} style={{color:colors.text,fontWeight:'700',fontSize:15}}>{name}</Text>
            <View style={{flexDirection:'row',alignItems:'center',gap:5}}><Ionicons name={outgoing?'arrow-up':'arrow-down'} size={13} color={missed?colors.danger:colors.muted}/>
              <Text numberOfLines={1} style={{fontSize:12,color:missed?colors.danger:colors.muted,flexShrink:1}}>{statusText(item,ownerId)}</Text></View>
          </Pressable>
          <View style={{alignItems:'flex-end',gap:4}}><Text style={{color:colors.muted,fontSize:10}}>{dateOf(item.created_at)}</Text><Text style={{color:colors.muted,fontSize:11}}>{timeOf(item.created_at)}</Text></View>
          {!selectionMode&&<IconButton icon="call-outline" label={`Позвонить: ${name}`} colors={colors} disabled={!peer||active||busy}
            onPress={()=>{if(peer)void startAudio(peer,item.conversation_id);}}/>}
        </View>;
      }}/>}
    <Modal transparent animationType="slide" visible={pickerOpen} onRequestClose={()=>setPickerOpen(false)}>
      <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#020814bb'}}>
        <View style={{maxHeight:'78%',minHeight:310,backgroundColor:colors.elevated,borderColor:colors.line,borderWidth:1,borderTopLeftRadius:24,borderTopRightRadius:24,padding:17}}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:13}}>
            <Text style={{fontWeight:'800',fontSize:19,color:colors.text}}>Кому позвонить?</Text>
            <IconButton icon="close" label="Закрыть" colors={colors} onPress={()=>setPickerOpen(false)}/>
          </View>
          <TextInput accessibilityLabel="Поиск контакта" placeholder="Найти контакт" placeholderTextColor={colors.muted}
            style={{borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface,color:colors.text,padding:12,borderRadius:15,marginBottom:10}}
            value={search} onChangeText={setSearch}/>
          <ScrollView keyboardShouldPersistTaps="handled">
            {contacts.length?contacts.map(person=><Pressable key={person.id} onPress={()=>void startAudio(person)} disabled={busy}
              style={{paddingVertical:11,flexDirection:'row',alignItems:'center',gap:11,borderBottomWidth:1,borderColor:colors.line}}>
              <Avatar name={person.display_name} url={avatars[person.id]} colors={colors} size={42}/>
              <Text numberOfLines={1} style={{color:colors.text,flex:1,fontSize:15}}>{person.display_name}</Text>
              <Ionicons name="call-outline" size={23} color={colors.accent}/>
            </Pressable>):<Text style={{color:colors.muted,textAlign:'center',padding:25}}>{search?'Ничего не найдено':'Контактов пока нет'}</Text>}
          </ScrollView>
          {busy&&<ActivityIndicator color={colors.accent} style={{padding:12}}/>}
        </View>
      </View>
    </Modal>
  </View>;
}
