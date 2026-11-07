import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,FlatList,Image,Pressable,Text,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {db, type Call,type Profile} from './backend';
import type {Palette} from './theme';

type JournalSetting = {owner_id:string;cleared_before:string|null;hidden_ids:string[]};
function callDescription(row:Call,selfId:string){
  if(row.status==='missed'||row.status==='declined')return row.status==='missed'?'Пропущенный':'Отклонённый';
  if(row.status==='failed')return 'Не удалось соединиться';
  const outgoing=row.caller_id===selfId;
  const prefix=outgoing?'Исходящий':'Входящий';
  if(row.answered_at&&row.ended_at){const duration=Math.max(0,Math.floor((Date.parse(row.ended_at)-Date.parse(row.answered_at))/1000));
    return `${prefix} · ${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`;}
  return prefix;
}
const Btn=({icon,label,colors,onPress,disabled}:{icon:keyof typeof Ionicons.glyphMap;label:string;colors:Palette;onPress:()=>void;disabled?:boolean})=><Pressable
  disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{padding:9,opacity:disabled ? 0.4 : 1}}>
  <Ionicons name={icon} color={colors.accent} size={23}/></Pressable>;
export default function ConnectNativeCalls({ownerId,profiles,avatars,colors,onDial}:{ownerId:string;profiles:Profile[];avatars:Record<string,string>;colors:Palette;onDial?:(conversationId:string,peer:Profile)=>void}) {
  const [rows,setRows]=useState<Call[]>([]);
  const [setting,setSetting]=useState<JournalSetting>({owner_id:ownerId,cleared_before:null,hidden_ids:[]});
  const [selected,setSelected]=useState<string[]>([]);
  const [selecting,setSelecting]=useState(false);
  const [showMenu,setShowMenu]=useState(false);
  const [filter,setFilter]=useState<'all'|'missed'>('all');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const reload=useCallback(async()=>{
    const [history,prefs]=await Promise.all([
      db.from('connect_calls').select('id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at')
        .or(`caller_id.eq.${ownerId},callee_id.eq.${ownerId}`).order('created_at',{ascending:false}).limit(150),
      db.from('connect_call_journal_settings').select('owner_id,cleared_before,hidden_ids').eq('owner_id',ownerId).maybeSingle(),
    ]);
    if(history.error||prefs.error)setError(history.error?.message||prefs.error?.message||'Ошибка журнала');
    else {setRows((history.data||[]) as Call[]);setSetting((prefs.data as JournalSetting|null)||{owner_id:ownerId,cleared_before:null,hidden_ids:[]});setError('');}
    setLoading(false);
  },[ownerId]);
  useEffect(()=>{setLoading(true);void reload();const t=setInterval(()=>void reload(),18000);return()=>clearInterval(t);},[reload]);
  const visible=useMemo(()=>rows.filter(c=>{
    if(setting.cleared_before && Date.parse(c.created_at)<=Date.parse(setting.cleared_before))return false;
    if(setting.hidden_ids.includes(c.id))return false;
    return filter!=='missed' || c.status==='missed'||c.status==='declined';
  }),[rows,setting,filter]);
  function deleteIds(ids:string[]){
    if(!ids.length)return;
    Alert.alert('Удалить записи?',`Удалить ${ids.length} записей только из твоего журнала?`,[
      {text:'Отмена',style:'cancel'},
      {text:'Удалить',style:'destructive',onPress:()=>void (async()=>{
        setBusy(true);
        try{
          const next={...setting,hidden_ids:Array.from(new Set([...(setting.hidden_ids||[]),...ids])),owner_id:ownerId};
          const r=await db.from('connect_call_journal_settings').upsert({...next,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
          if(r.error)throw r.error;
          setSetting(next);setSelected([]);setSelecting(false);
        }catch(e){setError('Не удалось удалить: '+(e instanceof Error?e.message:String(e)));}
        finally{setBusy(false);}
      })()}
    ]);
  }
  function clearAll(){
    if(!rows.length)return;
    Alert.alert('Очистить журнал?', 'Все существующие записи исчезнут только у тебя. Новые звонки будут появляться как обычно.',[
      {text:'Отмена',style:'cancel'},
      {text:'Очистить',style:'destructive',onPress:()=>void (async()=>{
        setBusy(true);
        try{
          const at=new Date().toISOString();
          const next={owner_id:ownerId,cleared_before:at,hidden_ids:[]};
          const r=await db.from('connect_call_journal_settings').upsert({...next,updated_at:at},{onConflict:'owner_id'});
          if(r.error)throw r.error;
          setSetting(next);setSelected([]);setSelecting(false);
        }catch(e){setError('Не удалось очистить: '+(e instanceof Error?e.message:String(e)));}
        finally{setBusy(false);}
      })()}
    ]);
  }
  const headerButton=(label:string,onPress:()=>void,disabled=false)=>
    <Pressable disabled={disabled} onPress={onPress} style={{paddingHorizontal:13,paddingVertical:9,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface,opacity:disabled ? 0.4 : 1}}>
      <Text style={{color:colors.text,fontSize:12}}>{label}</Text>
    </Pressable>;
  return <View style={{flex:1,backgroundColor:colors.bg}}>
    <View style={{padding:13,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
      <Text style={{color:colors.text,fontSize:26,fontWeight:'800'}}>Звонки</Text>
      <View style={{flexDirection:'row',alignItems:'center'}}>
        <Btn label="Новый звонок" icon="call-outline" colors={colors} onPress={()=>Alert.alert('Звонки','Нативный WebRTC + Android Telecom ещё подключаются. В WebView-версии вызовы продолжают работать.')}/>
        <Btn label="Меню журнала" icon="ellipsis-vertical" colors={colors} onPress={()=>setShowMenu(!showMenu)}/>
      </View>
    </View>
    {showMenu&&<View style={{backgroundColor:colors.surface,marginHorizontal:14,marginBottom:10,borderRadius:12,borderWidth:1,borderColor:colors.line}}>
      {headerButton('Выбрать записи',()=>{setSelecting(true);setShowMenu(false);})}
      {headerButton('Удалить выбранное',()=>{setShowMenu(false);deleteIds(selected);},!selected.length)}
      {headerButton('Очистить журнал',()=>{setShowMenu(false);clearAll();},!visible.length)}
    </View>}
    <View style={{flexDirection:'row',alignItems:'center',gap:7,margin:13}}>
      {headerButton('Все',()=>setFilter('all'))}{headerButton('Пропущенные',()=>setFilter('missed'))}
      {selecting&&<>{headerButton('Удалить',()=>deleteIds(selected),!selected.length)}{headerButton('Отмена',()=>{setSelecting(false);setSelected([]);})}</>}
    </View>
    {Boolean(error)&&<Pressable style={{padding:12}} onPress={()=>void reload()}><Text style={{color:colors.danger}}>{error} · Повторить</Text></Pressable>}
    {loading?<ActivityIndicator color={colors.accent} style={{marginTop:40}}/>:<FlatList data={visible} keyExtractor={x=>x.id} contentContainerStyle={{paddingHorizontal:13,paddingBottom:28,gap:7}}
      ListEmptyComponent={<Text style={{color:colors.muted,textAlign:'center',marginTop:40}}>Звонков пока нет</Text>}
      renderItem={({item})=>{
        const peerId=item.caller_id===ownerId?item.callee_id:item.caller_id;
        const peer=profiles.find(p=>p.id===peerId);
        const checked=selected.includes(item.id);
        const avatar=avatars[peerId];
        return <Pressable onPress={()=>{if(selecting)setSelected(x=>x.includes(item.id)?x.filter(y=>y!==item.id):[...x,item.id]);else if(peer&&onDial)onDial(item.conversation_id,peer);}}
          style={{flexDirection:'row',alignItems:'center',gap:11,borderRadius:16,padding:11,borderWidth:checked?2:1,
            borderColor:checked?colors.accent:colors.line,backgroundColor:colors.surface}}>
          {selecting&&<Ionicons name={checked?'checkbox':'square-outline'} size={24} color={colors.accent}/>}
          {avatar?<Image source={{uri:avatar}} style={{width:42,height:42,borderRadius:21}}/>:
            <View style={{width:42,height:42,borderRadius:21,backgroundColor:colors.elevated,alignItems:'center',justifyContent:'center'}}>
              <Ionicons name="person-outline" size={22} color={colors.accent}/></View>}
          <View style={{flex:1}}><Text numberOfLines={1} style={{color:colors.text,fontWeight:'700',fontSize:15}}>{peer?.display_name||'Собеседник'}</Text>
            <Text style={{fontSize:12,color:colors.muted,marginTop:5}}>{callDescription(item,ownerId)}</Text></View>
          <Text style={{color:colors.muted,fontSize:11}}>{new Date(item.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</Text>
        </Pressable>;
      }}/>} 
  </View>;
}
