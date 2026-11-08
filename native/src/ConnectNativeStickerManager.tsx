import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Image,Pressable,ScrollView,Switch,Text,TextInput,View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {File} from 'expo-file-system';
import {randomUUID} from 'expo-crypto';
import {db,mediaUrl} from './backend';
import type {Palette} from './theme';

type Pack={id:string;name:string;emoji:string;owner_id:string;is_public:boolean};
type Sticker={id:string;pack_id:string;name:string;storage_path:string};
const MAX_STICKER_BYTES=5*1024*1024;
const textError=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function ConnectNativeStickerManager({ownerId,colors}:{ownerId:string;colors:Palette}){
  const [packs,setPacks]=useState<Pack[]>([]);
  const [stickers,setStickers]=useState<Sticker[]>([]);
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [name,setName]=useState('');
  const [emoji,setEmoji]=useState('🎨');
  const [publicPack,setPublicPack]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [expanded,setExpanded]=useState<string|null>(null);
  const load=useCallback(async()=>{
    const p=await db.from('connect_sticker_packs').select('id,name,emoji,owner_id,is_public').eq('owner_id',ownerId).order('created_at',{ascending:false});
    if(p.error)throw p.error;
    const my=(p.data||[]) as Pack[];setPacks(my);
    if(!my.length){setStickers([]);return;}
    const r=await db.from('connect_stickers').select('id,pack_id,name,storage_path').in('pack_id',my.map(x=>x.id));
    if(r.error)throw r.error;
    const items=(r.data||[]) as Sticker[];setStickers(items);
    const next:Record<string,string>={};
    for(const item of items){
      const res=await db.storage.from('connect-stickers').createSignedUrl(item.storage_path,3600);
      if(res.data?.signedUrl)next[item.id]=mediaUrl(res.data.signedUrl);
    }
    setUrls(next);
  },[ownerId]);
  useEffect(()=>{void load().catch(e=>setError(textError(e)));},[load]);
  async function create(){
    if(!name.trim()||busy)return;
    setBusy(true);setError('');
    try{
      const result=await db.from('connect_sticker_packs').insert({owner_id:ownerId,name:name.trim().slice(0,60),emoji:emoji.trim().slice(0,8)||'🎨',is_public:publicPack});
      if(result.error)throw result.error;
      setName('');await load();
    }catch(e){setError(textError(e));}finally{setBusy(false);}
  }
  async function addStickers(pack:Pack){
    if(busy)return;
    try{
      const pick=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,quality:1});
      if(pick.canceled||!pick.assets.length)return;
      setBusy(true);setError('');
      for(const item of pick.assets){
        const file=new File(item.uri);
        if(file.size<1||file.size>MAX_STICKER_BYTES)throw Error('Стикер должен быть до 5 МБ');
        const mime=item.mimeType||'image/jpeg';
        if(!['image/png','image/webp','image/gif','image/jpeg'].includes(mime))throw Error('Поддерживаются PNG, WebP, GIF и JPEG');
        const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':mime==='image/gif'?'gif':'jpg';
        const storagePath=`${ownerId}/${pack.id}/${randomUUID()}.${ext}`;
        const data=await file.arrayBuffer();
        const up=await db.storage.from('connect-stickers').upload(storagePath,data,{contentType:mime,upsert:false});
        if(up.error)throw up.error;
        const insert=await db.from('connect_stickers').insert({pack_id:pack.id,name:(item.fileName||`Стикер ${Date.now()}`).replace(/\.[^.]+$/,'').slice(0,60),storage_path:storagePath});
        if(insert.error){await db.storage.from('connect-stickers').remove([storagePath]);throw insert.error;}
      }
      await load();
    }catch(e){setError(textError(e));}finally{setBusy(false);}
  }
  function removeSticker(st:Sticker){
    Alert.alert('Удалить стикер?',st.name,[{text:'Отмена',style:'cancel'},{text:'Удалить',style:'destructive',onPress:()=>void(async()=>{
      setBusy(true);try{
        const r=await db.from('connect_stickers').delete().eq('id',st.id);
        if(r.error)throw r.error;
        await db.storage.from('connect-stickers').remove([st.storage_path]);await load();
      }catch(e){setError(textError(e));}finally{setBusy(false);}
    })()}]);
  }
  function removePack(pack:Pack){
    Alert.alert('Удалить набор?',`${pack.name}: удалятся все его стикеры.`,[{text:'Отмена',style:'cancel'},{text:'Удалить',style:'destructive',onPress:()=>void(async()=>{
      setBusy(true);try{
        const items=stickers.filter(s=>s.pack_id===pack.id);
        if(items.length){const r=await db.from('connect_stickers').delete().eq('pack_id',pack.id);if(r.error)throw r.error;}
        const p=await db.from('connect_sticker_packs').delete().eq('id',pack.id);if(p.error)throw p.error;
        if(items.length)await db.storage.from('connect-stickers').remove(items.map(s=>s.storage_path));
        await load();
      }catch(e){setError(textError(e));}finally{setBusy(false);}
    })()}]);
  }
  const field={borderWidth:1,borderColor:colors.line,borderRadius:13,padding:11,color:colors.text,backgroundColor:colors.surface} as const;
  const btn={padding:11,borderRadius:12,backgroundColor:colors.elevated,alignItems:'center' as const};
  return <View style={{gap:10}}>
    <View style={{gap:10,padding:14,borderRadius:18,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface}}>
      <TextInput value={name} onChangeText={setName} maxLength={60} placeholder="Название нового набора" placeholderTextColor={colors.muted} style={field}/>
      <TextInput value={emoji} onChangeText={setEmoji} maxLength={8} placeholder="Эмодзи набора" placeholderTextColor={colors.muted} style={field}/>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{color:colors.text}}>Доступен всем участникам</Text><Switch value={publicPack} onValueChange={setPublicPack}/></View>
      <Pressable onPress={()=>void create()} disabled={busy||!name.trim()} style={[btn,{opacity:busy||!name.trim() ? .5 : 1}]}><Text style={{color:colors.accent,fontWeight:'700'}}>Создать набор</Text></Pressable>
    </View>
    {packs.map(pack=>{
      const items=stickers.filter(st=>st.pack_id===pack.id);
      return <View key={pack.id} style={{padding:13,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface,borderRadius:18,gap:10}}>
        <Pressable onPress={()=>setExpanded(old=>old===pack.id?null:pack.id)}><Text style={{fontSize:15,fontWeight:'700',color:colors.text}}>{pack.emoji} {pack.name} · {items.length}</Text><Text style={{color:colors.muted,fontSize:12}}>{pack.is_public?'Общий':'Личный'} · нажмите для управления</Text></Pressable>
        {expanded===pack.id&&<>
          <ScrollView horizontal>{items.map(st=><Pressable key={st.id} onPress={()=>removeSticker(st)} style={{width:72,marginRight:9,alignItems:'center'}}>{urls[st.id]&&<Image source={{uri:urls[st.id]}} style={{width:68,height:68}} resizeMode="contain"/>}<Text numberOfLines={1} style={{color:colors.muted,fontSize:10}}>{st.name}</Text></Pressable>)}</ScrollView>
          <Pressable style={btn} disabled={busy} onPress={()=>void addStickers(pack)}><Text style={{color:colors.accent}}>Добавить стикеры</Text></Pressable>
          <Pressable style={btn} disabled={busy} onPress={()=>removePack(pack)}><Text style={{color:colors.danger}}>Удалить набор</Text></Pressable>
          <Text style={{color:colors.muted,fontSize:11}}>Нажмите стикер, чтобы удалить его.</Text>
        </>}
      </View>;
    })}
    {!!error&&<Text style={{color:colors.danger}}>{error}</Text>}
    {busy&&<ActivityIndicator color={colors.accent}/>}
  </View>;
}
