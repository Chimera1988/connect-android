/** Connect Native stickers — compatible with the existing Connect PWA message format.
 * Built-ins use the SVG assets already served by Connect PWA. Custom packs use
 * the existing connect_sticker_packs / connect_stickers tables and signed storage URLs.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator,Image,Pressable,ScrollView,Text,View} from 'react-native';
import {SvgUri} from 'react-native-svg';
import {db,mediaUrl} from './backend';
import type {Palette} from './theme';

type Pack = {id:'speed'|'blocks'|'anime-boys'|'anime-girls';name:string;emoji:string};
type Mood = {id:string;title:string};
type CustomPack = {id:string;owner_id:string;name:string;emoji:string;is_public:boolean};
type CustomSticker = {id:string;pack_id:string;name:string;storage_path:string;position:number};
export type StickerReference = {kind:'built-in';pack:Pack['id'];id:string}|{kind:'custom';id:string};
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const customPattern=new RegExp(`^\\[\\[connect-custom-sticker:(${UUID})\\]\\]$`,'i');
const commonPattern=/^\[\[connect-sticker:([a-z-]+):([a-z]+)\]\]$/;
const packs:Pack[]=[
  {id:'speed',name:'Соник',emoji:'⚡'},
  {id:'blocks',name:'Minecraft',emoji:'🧱'},
  {id:'anime-boys',name:'Аниме-парни',emoji:'👦'},
  {id:'anime-girls',name:'Аниме-девушки',emoji:'👧'},
];
const moods:Mood[]=[
  {id:'hello',title:'Привет'},{id:'love',title:'Любовь'},{id:'laugh',title:'Смех'},
  {id:'wow',title:'Удивление'},{id:'sad',title:'Грусть'},{id:'angry',title:'Злость'},
  {id:'wink',title:'Подмигивание'},{id:'sleep',title:'Сплю'},{id:'thanks',title:'Спасибо'},
  {id:'cool',title:'Круто'},{id:'facepalm',title:'Фейспалм'},{id:'thinking',title:'Думаю'},
  {id:'cry',title:'Плачу'},{id:'shy',title:'Смущение'},{id:'party',title:'Ура'},
  {id:'hug',title:'Обнимашки'},{id:'nope',title:'Нет'},{id:'yes',title:'Да'},
  {id:'shock',title:'Шок'},{id:'heart',title:'Сердечко'},{id:'coffee',title:'Кофе'},
  {id:'gaming',title:'Играю'},{id:'bye',title:'Пока'},{id:'tired',title:'Устал'},
];
const emojis=['😀','😁','😂','🤣','😊','😍','🥰','😘','😎','🥹','😢','😭','😡','🤔','😴','🙃','😏','😅','😇','😱','🤩','😜','😌','🥺','❤️','💙','💚','💜','🖤','💕','🔥','🎉','👍','👎','👏','🙏','🤝','💪','👋','👌','⭐','✨','🎮','⚡','🌙','☕','🌹','🥳'];
const FAVORITE_NAME='Избранное из чатов · Connect';
const STATIC_BASE=(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'');
const builtInUrl=(pack:Pack['id'],id:string)=>`${STATIC_BASE}/stickers/${pack}/${id}.svg`;
const textError=(e:unknown)=>e instanceof Error?e.message:String(e);

export function parseStickerReference(value:string):StickerReference|null {
  const common=commonPattern.exec(value);
  if(common&&packs.some(p=>p.id===common[1])&&moods.some(m=>m.id===common[2]))
    return {kind:'built-in',pack:common[1] as Pack['id'],id:common[2]};
  const custom=customPattern.exec(value);
  if(custom)return {kind:'custom',id:custom[1].toLowerCase()};
  return null;
}

/** A transparent sticker bubble, including private/public user-created stickers. */
export function ConnectNativeStickerBubble({body,colors}:{body:string;colors:Palette}) {
  const ref=useMemo(()=>parseStickerReference(body),[body]);
  const [uri,setUri]=useState<string|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!ref||ref.kind!=='custom'){setUri(null);setFailed(false);return;}
    let alive=true;
    setFailed(false);setUri(null);
    void (async()=>{
      try{
        const item=await db.from('connect_stickers').select('id,storage_path').eq('id',ref.id).maybeSingle();
        if(item.error||!item.data)throw new Error('Стикер недоступен');
        const url=await db.storage.from('connect-stickers').createSignedUrl(item.data.storage_path,3600);
        if(url.error||!url.data?.signedUrl)throw new Error('Стикер недоступен');
        if(alive)setUri(mediaUrl(url.data.signedUrl));
      }catch{if(alive)setFailed(true);}
    })();
    return()=>{alive=false;};
  },[ref?.kind,ref?.kind==='custom'?ref.id:'']);
  if(!ref)return null;
  if(ref.kind==='built-in')return <SvgUri width={150} height={150} uri={builtInUrl(ref.pack,ref.id)}/>;
  if(uri)return <Image source={{uri}} resizeMode="contain" style={{width:150,height:150}}/>;
  return <View style={{width:150,height:150,justifyContent:'center',alignItems:'center'}}>
    {failed?<Text style={{fontSize:12,color:colors.muted,textAlign:'center'}}>Стикер недоступен</Text>
      :<ActivityIndicator color={colors.accent}/>}
  </View>;
}

export default function ConnectNativeStickerPicker({colors,ownerId,busy,onSend,onEmoji,onClose}:{
  colors:Palette;ownerId:string;busy:boolean;onSend:(body:string)=>Promise<void>;onEmoji:(emoji:string)=>void;onClose:()=>void;
}) {
  const [selected,setSelected]=useState('speed');
  const [customPacks,setCustomPacks]=useState<CustomPack[]>([]);
  const [customStickers,setCustomStickers]=useState<CustomSticker[]>([]);
  const [customUrls,setCustomUrls]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try{
        const [p,s]=await Promise.all([
          db.from('connect_sticker_packs').select('id,owner_id,name,emoji,is_public').order('created_at',{ascending:false}).limit(100),
          db.from('connect_stickers').select('id,pack_id,name,storage_path,position').order('position',{ascending:true}).limit(1200),
        ]);
        if(p.error||s.error)throw new Error(p.error?.message||s.error?.message||'Наборы недоступны');
        const visible=(p.data||[]) as CustomPack[];
        const owned=new Set(visible.map(x=>x.id));
        const list=((s.data||[]) as CustomSticker[]).filter(x=>owned.has(x.pack_id));
        if(!alive)return;
        setCustomPacks(visible);setCustomStickers(list);setLoading(false);
      }catch(e){if(alive){setError(textError(e));setLoading(false);}}
    })();
    return()=>{alive=false;};
  },[ownerId]);
  const active=customPacks.find(x=>x.id===selected);
  const chosen=active?customStickers.filter(s=>s.pack_id===active.id):[];
  useEffect(()=>{
    if(!active)return;
    let alive=true;
    // Resolve only the selected pack; signing every image from all packs at once
    // can overwhelm mobile networks and wastes tokens on files never viewed.
    const selectedStickers=customStickers.filter(x=>x.pack_id===active.id).slice(0,120);
    void Promise.all(selectedStickers.map(async item=>{
      try{
        const res=await db.storage.from('connect-stickers').createSignedUrl(item.storage_path,3600);
        return [item.id,res.data?.signedUrl?mediaUrl(res.data.signedUrl):''] as const;
      }catch{return [item.id,''] as const;}
    })).then(rows=>{
      if(alive)setCustomUrls(prev=>({...prev,...Object.fromEntries(rows.filter(([,url])=>Boolean(url)))}));
    });
    return()=>{alive=false;};
  },[selected,customStickers]);
  const tabStyle={borderRadius:14,borderWidth:1,borderColor:colors.line,backgroundColor:colors.elevated,paddingVertical:8,paddingHorizontal:11,marginRight:6} as const;
  const toggleButton=(value:string,title:string)=>
    <Pressable key={value} accessibilityRole="button" accessibilityLabel={'Открыть '+title} onPress={()=>setSelected(value)}
      style={[tabStyle,{borderColor:selected===value?colors.accent:colors.line,backgroundColor:selected===value?colors.surface:colors.elevated}]}>
      <Text style={{color:selected===value?colors.accent:colors.text,fontSize:13}}>{title}</Text>
    </Pressable>;
  return <View style={{height:298,backgroundColor:colors.surface,borderTopColor:colors.line,borderTopWidth:1,paddingTop:9,paddingHorizontal:10}}>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:7}}>
      <Text style={{color:colors.text,fontWeight:'700',fontSize:15}}>Стикеры и эмодзи</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Закрыть стикеры" onPress={onClose} style={{padding:7}}>
        <Text style={{color:colors.accent}}>Закрыть ✕</Text>
      </Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={{flexGrow:0,marginBottom:9}}>
      {toggleButton('emoji','☺ Эмодзи')}
      {packs.map(p=>toggleButton(p.id,`${p.emoji} ${p.name}`))}
      {customPacks.map(p=>toggleButton(p.id,`${p.name===FAVORITE_NAME?'⭐':p.emoji||'🎨'} ${p.name===FAVORITE_NAME?'Избранное':p.name}`))}
    </ScrollView>
    {loading&&<ActivityIndicator color={colors.accent} style={{marginTop:30}}/>}
    {!!error&&<Text style={{color:colors.danger,fontSize:12}}>{error}</Text>}
    {!loading&&<ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{flexDirection:'row',flexWrap:'wrap',gap:8,paddingBottom:18,justifyContent:'flex-start'}}>
      {selected==='emoji'&&emojis.map((emoji,i)=><Pressable key={`${emoji}-${i}`} disabled={busy}
        accessibilityRole="button" accessibilityLabel={'Вставить '+emoji} onPress={()=>onEmoji(emoji)}
        style={{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:colors.elevated}}>
        <Text style={{fontSize:28}}>{emoji}</Text>
      </Pressable>)}
      {packs.some(p=>p.id===selected)&&moods.map(m=><Pressable key={m.id} disabled={busy}
        accessibilityRole="button" accessibilityLabel={'Отправить '+m.title}
        onPress={()=>void onSend(`[[connect-sticker:${selected}:${m.id}]]`)}
        style={{width:78,height:89,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:colors.elevated}}>
        <SvgUri width={67} height={67} uri={builtInUrl(selected as Pack['id'],m.id)}/>
        <Text numberOfLines={1} style={{fontSize:10,color:colors.muted}}>{m.title}</Text>
      </Pressable>)}
      {active&&chosen.map(st=><Pressable key={st.id} disabled={busy||!customUrls[st.id]}
        accessibilityRole="button" accessibilityLabel={'Отправить '+st.name}
        onPress={()=>void onSend(`[[connect-custom-sticker:${st.id}]]`)}
        style={{width:78,height:89,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:colors.elevated}}>
        {customUrls[st.id]?<Image source={{uri:customUrls[st.id]}} resizeMode="contain" style={{width:70,height:70}}/>
          :<ActivityIndicator color={colors.accent}/>}
        <Text numberOfLines={1} style={{fontSize:10,color:colors.muted}}>{st.name}</Text>
      </Pressable>)}
      {active&&!chosen.length&&<Text style={{fontSize:13,color:colors.muted,padding:12}}>В этом наборе пока нет стикеров.</Text>}
    </ScrollView>}
  </View>;
}
