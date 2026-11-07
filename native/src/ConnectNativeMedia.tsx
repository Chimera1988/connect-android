import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {useAudioPlayer, useAudioPlayerStatus} from 'expo-audio';
import {useVideoPlayer, VideoView} from 'expo-video';
import {db} from './backend';
import {DIRECT_UPLOAD_LIMIT, fileExtension, listMedia, nameForStorage, signedObject, uploadFile, type ListedMedia, type LocalUpload, type MediaKind} from './nativeMediaUtils';
import type {Message} from './backend';
import type {Palette} from './theme';

const c = (p:Palette) => StyleSheet.create({
  card:{backgroundColor:p.surface,borderColor:p.line,borderWidth:1,borderRadius:17,padding:12,marginBottom:9},
  text:{color:p.text,fontSize:14},muted:{color:p.muted,fontSize:12},title:{color:p.text,fontWeight:'700',fontSize:17},
  row:{flexDirection:'row',alignItems:'center',gap:12},
  action:{backgroundColor:p.elevated,borderColor:p.line,borderWidth:1,borderRadius:12,paddingHorizontal:12,paddingVertical:10},
});
function IconButton({name, onPress, colors, label, disabled}:{name:keyof typeof Ionicons.glyphMap;onPress:()=>void;colors:Palette;label:string;disabled?:boolean}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
    style={{padding:8,opacity:disabled ? 0.4 : 1}}><Ionicons name={name} size={22} color={colors.accent}/></Pressable>;
}
function AudioClip({uri,colors}:{uri:string;colors:Palette}) {
  const player = useAudioPlayer(uri,{updateInterval:250});
  const state = useAudioPlayerStatus(player);
  return <View style={{flexDirection:'row',alignItems:'center',gap:10,flex:1}}>
    <IconButton name={state.playing?'pause-circle':'play-circle'} label={state.playing?'Пауза':'Воспроизвести'} colors={colors}
      onPress={()=>state.playing?player.pause():player.play()}/>
    <Text style={{color:colors.muted,fontSize:12}}>{Math.floor(state.currentTime||0)} / {Math.floor(state.duration||0)} с</Text>
  </View>;
}
function VideoClip({uri}:{uri:string}) {
  const player=useVideoPlayer(uri,instance=>{instance.loop=false;});
  return <VideoView player={player} style={{width:'100%',height:310,backgroundColor:'#000',borderRadius:14}} nativeControls contentFit="contain"/>;
}
export function ConnectNativeMediaViewer({url,kind,title,onClose,colors,onPrevious,onNext,count,index}:{
  url:string;kind:'photos'|'videos';title:string;onClose:()=>void;colors:Palette;onPrevious?:()=>void;onNext?:()=>void;count?:number;index?:number;
}) {
  const finger=useRef<{x:number;y:number}|null>(null);
  return <Modal animationType="fade" presentationStyle="fullScreen" visible transparent={false} onRequestClose={onClose}>
    <View style={{flex:1,backgroundColor:'#081018',paddingTop:38,paddingBottom:32}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:15}}>
        <Text numberOfLines={1} style={{color:'#fff',flex:1,fontSize:13}}>{title}</Text>
        <IconButton name="close" label="Закрыть" onPress={onClose} colors={colors}/>
      </View>
      <View style={{flex:1,justifyContent:'center'}}
        onTouchStart={e=>{const t=e.nativeEvent.touches[0];if(t)finger.current={x:t.pageX,y:t.pageY};}}
        onTouchEnd={e=>{
          if(!finger.current||!count||count<2)return;
          const t=e.nativeEvent.changedTouches[0];if(!t)return;
          const dx=t.pageX-finger.current.x,dy=t.pageY-finger.current.y;finger.current=null;
          if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.4){if(dx<0)onNext?.();else onPrevious?.();}
        }}>
        {kind==='photos'?<Image source={{uri:url}} resizeMode="contain" style={{width:'100%',height:'85%'}}/>:<VideoClip key={url} uri={url}/>}
      </View>
      {Boolean(count && count>1)&&<View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:14}}>
        <IconButton name="chevron-back-circle" label="Предыдущий файл" onPress={()=>onPrevious?.()} colors={colors}/>
        <Text style={{color:'#fff'}}>{(index||0)+1} / {count}</Text>
        <IconButton name="chevron-forward-circle" label="Следующий файл" onPress={()=>onNext?.()} colors={colors}/>
      </View>}
    </View>
  </Modal>;
}
export function ConnectNativeAttachment({message,colors}:{message:Message;colors:Palette}) {
  const [url,setUrl]=useState<string|null>(null);
  const [view,setView]=useState(false);
  useEffect(()=>{
    let alive=true;
    if(!message.attachment_path){setUrl(null);return;}
    void signedObject('connect-attachments',message.attachment_path).then(next=>{if(alive)setUrl(next);});
    return()=>{alive=false;};
  },[message.attachment_path]);
  if(!message.attachment_path)return null;
  const k=message.attachment_kind;
  const name=message.attachment_name||'Вложение';
  if(!url)return <Text style={{color:colors.muted}}>Загружаем вложение…</Text>;
  if(k==='image')return <><Pressable accessibilityRole="button" accessibilityLabel={`Открыть фото ${name}`} onPress={()=>setView(true)}>
      <Image source={{uri:url}} resizeMode="cover" style={{width:230,height:205,borderRadius:13}}/>
    </Pressable>{view&&<ConnectNativeMediaViewer url={url} kind="photos" title={name} onClose={()=>setView(false)} colors={colors}/>}</>;
  if(k==='video')return <><IconButton name="play-circle" label={`Открыть видео ${name}`} colors={colors} onPress={()=>setView(true)}/>
    <Text numberOfLines={2} style={{color:colors.text}}>{name}</Text>
    {view&&<ConnectNativeMediaViewer url={url} kind="videos" title={name} onClose={()=>setView(false)} colors={colors}/>}</>;
  if(k==='audio'||(message.attachment_type||'').startsWith('audio/'))return <View style={{maxWidth:255}}><Text numberOfLines={1} style={{color:colors.text}}>{name}</Text><AudioClip uri={url} colors={colors}/></View>;
  return <Pressable onPress={()=>void Linking.openURL(url).catch(()=>Alert.alert('Не удалось открыть файл'))} style={{flexDirection:'row',alignItems:'center',gap:8}}>
    <Ionicons name="document-attach-outline" size={22} color={colors.accent}/><Text numberOfLines={2} style={{color:colors.text,flexShrink:1}}>{name}</Text>
  </Pressable>;
}

export default function ConnectNativeMedia({ownerId,kind,owner,onBack,colors}:{ownerId:string;kind:MediaKind;owner:boolean;onBack:()=>void;colors:Palette}) {
  const [items,setItems]=useState<ListedMedia[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<number|null>(null);
  const style=useMemo(()=>c(colors),[colors]);
  const label={photos:'Фото',videos:'Видео',music:'Музыка'}[kind];
  const reload=useCallback(async()=>{
    try {const rows=await listMedia(ownerId,kind);setItems(rows);setError('');}
    catch(e){setError(e instanceof Error?e.message:'Ошибка загрузки медиатеки');}
    finally{setLoading(false);}
  },[ownerId,kind]);
  useEffect(()=>{setLoading(true);void reload();},[reload]);
  async function addFile(){
    if(!owner||busy)return;
    let files:LocalUpload[]=[];
    try{
      if(kind==='music'){
        const pick=await DocumentPicker.getDocumentAsync({type:'audio/*',multiple:false,copyToCacheDirectory:true});
        if(!pick.canceled)files=pick.assets.map(a=>({uri:a.uri,name:a.name,mime:a.mimeType||'audio/mpeg',size:a.size}));
      }else{
        const pick=await ImagePicker.launchImageLibraryAsync({mediaTypes:kind==='photos'?['images' as const]:['videos' as const],allowsMultipleSelection:true,quality:1});
        if(!pick.canceled)files=pick.assets.map(a=>({uri:a.uri,name:a.fileName||`${kind}-${Date.now()}.${kind==='photos'?'jpg':'mp4'}`,mime:a.mimeType||(kind==='photos'?'image/jpeg':'video/mp4'),size:a.fileSize}));
      }
      if(!files.length)return;
      setBusy(true);
      for(const file of files){
        if(!fileExtension(file.name))throw Error('Неизвестный формат файла');
        const path=`${ownerId}/${kind}/${nameForStorage(file.name)}`;
        await uploadFile('connect-profile-media',path,file);
      }
      await reload();
    }catch(e){Alert.alert('Не удалось загрузить',e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  function deleteMedia(item:ListedMedia){
    if(!owner||busy)return;
    Alert.alert('Удалить файл?',item.name,[{text:'Отмена',style:'cancel'},{text:'Удалить',style:'destructive',onPress:()=>void (async()=>{
      setBusy(true);
      const r=await db.storage.from('connect-profile-media').remove([item.path]);
      if(r.error)Alert.alert('Ошибка удаления',r.error.message);
      else await reload();
      setBusy(false);
    })()}]);
  }
  const active=selected!==null?items[selected]:null;
  const validViewer=kind==='photos'||kind==='videos';
  return <View style={{flex:1,backgroundColor:colors.bg}}>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:12,borderBottomWidth:1,borderBottomColor:colors.line}}>
      <View style={{flexDirection:'row',alignItems:'center',gap:5}}><IconButton name="chevron-back" label="Назад" onPress={onBack} colors={colors}/><Text style={style.title}>{label}</Text></View>
      {owner&&<Pressable style={style.action} onPress={()=>void addFile()} disabled={busy}><Text style={style.text}>+ Добавить</Text></Pressable>}
    </View>
    {loading?<ActivityIndicator style={{marginTop:40}} color={colors.accent}/>:<ScrollView contentContainerStyle={{padding:14,paddingBottom:36}}>
      {Boolean(error)&&<Text style={{color:colors.danger,marginBottom:12}}>{error}</Text>}
      {!items.length?<Text style={style.muted}>Здесь пока нет файлов.</Text>:items.map((item,i)=><View key={item.path} style={[style.card,style.row]}>
        <Pressable onPress={()=>{if(validViewer)setSelected(i);}} style={{flex:1,flexDirection:'row',alignItems:'center',gap:11}} accessibilityRole="button">
          {kind==='photos'?<Image source={{uri:item.url}} style={{width:60,height:60,borderRadius:11}}/>:
            <Ionicons name={kind==='videos'?'videocam-outline':'musical-notes-outline'} size={25} color={colors.accent}/>}
          <View style={{flex:1}}><Text style={style.text} numberOfLines={2}>{item.name}</Text>
            <Text style={style.muted}>{item.size?`${(item.size/1024/1024).toFixed(1)} МБ`:label}</Text></View>
        </Pressable>
        {kind==='music'&&<View style={{flex:1}}><AudioClip uri={item.url} colors={colors}/></View>}
        {owner&&<IconButton name="trash-outline" label={`Удалить ${item.name}`} colors={colors} onPress={()=>deleteMedia(item)}/>}
      </View>)}
      <Text style={[style.muted,{marginTop:12}]}>Файлы видны участникам Connect. Пока доступна загрузка до {DIRECT_UPLOAD_LIMIT/1024/1024} МБ за файл.</Text>
    </ScrollView>}
    {validViewer && active&&<ConnectNativeMediaViewer key={active.path} url={active.url} title={active.name} kind={kind as 'photos'|'videos'} colors={colors}
      count={items.length} index={selected||0} onClose={()=>setSelected(null)}
      onPrevious={()=>setSelected(x=>x===null?null:(x-1+items.length)%items.length)}
      onNext={()=>setSelected(x=>x===null?null:(x+1)%items.length)}/>}
  </View>;
}
