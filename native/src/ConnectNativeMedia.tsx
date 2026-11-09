import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Alert, AppState, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {File} from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import {useAudioPlayer, useAudioPlayerStatus} from 'expo-audio';
import {useVideoPlayer, VideoView} from 'expo-video';
import {db} from './backend';
import {getAudioWaveform} from './nativeWaveform';
import {ConnectNativeMusicLibrary} from './ConnectNativeMusic';
import ConnectNativeAvatarCropper,{type AvatarSource,type CroppedAvatar} from './ConnectNativeAvatarCropper';
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
// CONNECT_NATIVE_PWA_PHASE5_MEDIA: seekable audio messages with 1x/1.5x/2x playback.
const audioClock=(value:number)=>{
  const n=Math.max(0,Math.floor(Number.isFinite(value)?value:0));
  return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;
};
const activeVoicePlayers=new Set<{pause:()=>void}>();
function AudioClip({uri,colors}:{uri:string;colors:Palette}) {
  const player=useAudioPlayer(uri,{updateInterval:250});
  const state=useAudioPlayerStatus(player);
  const [speed,setSpeed]=useState(1);
  const [barWidth,setBarWidth]=useState(1);
  const [bars,setBars]=useState<number[]>(()=>Array(43).fill(.14));
  const duration=Math.max(0,state.duration||0);
  const position=Math.max(0,Math.min(duration,state.currentTime||0));
  const fraction=duration>0?position/duration:0;
  useEffect(()=>{
    activeVoicePlayers.add(player);
    return()=>{activeVoicePlayers.delete(player);};
  },[player]);
  useEffect(()=>{
    let alive=true;
    setBars(Array(43).fill(.14));
    void getAudioWaveform(uri).then(values=>{if(alive)setBars(values);}).catch(()=>{
      // Unsupported codec / old development build: listening remains available.
    });
    return()=>{alive=false;};
  },[uri]);
  async function togglePlayer(){
    if(state.playing){player.pause();return;}
    for(const other of activeVoicePlayers)if(other!==player)other.pause();
    player.play();
  }
  return <View style={{width:260,maxWidth:'100%',gap:4}}>
    <View style={{flexDirection:'row',alignItems:'center',gap:5}}>
      <IconButton name={state.playing?'pause-circle':'play-circle'} label={state.playing?'Пауза':'Воспроизвести'} colors={colors}
        onPress={()=>void togglePlayer()}/>
      <Pressable accessibilityRole="button" accessibilityLabel={`Перемотка аудио: ${audioClock(position)} из ${audioClock(duration)}`}
        onLayout={event=>setBarWidth(Math.max(1,event.nativeEvent.layout.width))}
        onPress={event=>{if(duration>0){const x=event.nativeEvent.locationX;void player.seekTo(Math.max(0,Math.min(duration,duration*x/barWidth)));}}}
        style={{height:35,flex:1,justifyContent:'center',flexDirection:'row',alignItems:'center',gap:1}}>
        {bars.map((value,index)=><View key={index} pointerEvents="none" style={{flex:1,minWidth:1,
          height:Math.round(4+22*value),borderRadius:2,
          backgroundColor:index/43<=fraction?colors.accent:colors.muted}}/>)}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Скорость воспроизведения ${speed}x`}
        onPress={()=>{const next=speed===1?1.5:speed===1.5?2:1;player.setPlaybackRate(next);setSpeed(next);}}
        style={{paddingHorizontal:7,paddingVertical:5,borderRadius:8,backgroundColor:colors.elevated}}>
        <Text style={{color:colors.accent,fontWeight:'700',fontSize:12}}>{speed}×</Text>
      </Pressable>
    </View>
    <Text style={{color:colors.muted,fontSize:11,marginLeft:7}}>{audioClock(position)} / {audioClock(duration)}</Text>
  </View>;
}
/** Share a downloaded attachment through Android's file chooser.
 * Never send message files to Connect or third parties automatically.
 */
function SaveAttachment({url,name,mime,colors}:{url:string;name:string;mime:string;colors:Palette}){
  const [working,setWorking]=useState(false);
  async function save(){
    if(working)return;
    setWorking(true);
    try{
      if(!FileSystem.cacheDirectory)throw Error('Кэш Android недоступен');
      if(!await Sharing.isAvailableAsync())throw Error('Системное меню сохранения недоступно');
      const extension=fileExtension(name).replace(/[^a-z0-9]/g,'').slice(0,8)||'bin';
      const local=FileSystem.cacheDirectory+`connect-file-${Date.now()}-${Math.floor(Math.random()*100000)}.${extension}`;
      const downloaded=await FileSystem.downloadAsync(url,local);
      if(downloaded.status!==200)throw Error('Загрузка файла завершилась с ошибкой');
      await Sharing.shareAsync(downloaded.uri,{mimeType:mime||'application/octet-stream',dialogTitle:'Сохранить или отправить файл'});
      // Do not immediately unlink the share target: receiving apps may read it
      // after Android's chooser closes. OS will eventually evict app cache.
    }catch(e){Alert.alert('Не удалось сохранить файл',e instanceof Error?e.message:String(e));}
    finally{setWorking(false);}
  }
  return <Pressable accessibilityRole="button" accessibilityLabel={`Сохранить или поделиться: ${name}`}
    disabled={working} onPress={()=>void save()}
    style={{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:7,paddingVertical:5,opacity:working?0.5:1}}>
    <Ionicons name="download-outline" color={colors.accent} size={17}/>
    <Text style={{fontSize:11,color:colors.accent}}>{working?'Загружаем…':'Сохранить / Поделиться'}</Text>
  </Pressable>;
}
function AttachmentImage({url}:{url:string}){
  const [height,setHeight]=useState(205);
  useEffect(()=>{
    let alive=true;
    Image.getSize(url,(w,h)=>{
      if(alive&&w>0&&h>0)setHeight(Math.max(70,Math.min(330,Math.round(230*h/w))));
    },()=>{});
    return()=>{alive=false;};
  },[url]);
  return <Image source={{uri:url}} resizeMode="contain" style={{width:230,height,borderRadius:13}}/>;
}
function VideoClip({uri}:{uri:string}) {
  const player=useVideoPlayer(uri,instance=>{instance.loop=false;});
  return <VideoView player={player} style={{width:'100%',height:310,backgroundColor:'#000',borderRadius:14}} nativeControls contentFit="contain"/>;
}

/** PWA videos loop silently while visible; sound and full-screen are separate controls. */
export function ConnectNativeInlineVideo({uri,path,colors,active,onOpen}:{uri:string;path:string;colors:Palette;active:boolean;onOpen:()=>void}){
  const player=useVideoPlayer(uri,instance=>{instance.loop=true;instance.muted=true;});
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const [muted,setMuted]=useState(true);
  const [failed,setFailed]=useState(false);
  const [poster,setPoster]=useState<string|null>(null);
  const [firstFrame,setFirstFrame]=useState(false);
  const dimensions=/__vid_(\d{1,5})x(\d{1,5})$/.exec(path);
  const [ratio,setRatio]=useState(dimensions?Number(dimensions[1])/Math.max(1,Number(dimensions[2])):4/3);
  const height=Math.max(110,Math.min(330,230/Math.max(.1,ratio)));
  useEffect(()=>{
    let alive=true;setPoster(null);setFirstFrame(false);
    if(/__vid_\d{1,5}x\d{1,5}$/.test(path))void signedObject('connect-attachments',path+'__poster.jpg')
      .then(url=>{if(alive)setPoster(url);}).catch(()=>{});
    return()=>{alive=false;};
  },[path]);
  useEffect(()=>{
    const state=AppState.addEventListener('change',value=>setForeground(value==='active'));
    const status=player.addListener('statusChange',event=>setFailed(event.status==='error'));
    const source=player.addListener('sourceLoad',event=>{
      const size=event.availableVideoTracks[0]?.size;
      if(size&&size.width>0&&size.height>0)setRatio(size.width/size.height);
    });
    return()=>{state.remove();status.remove();source.remove();};
  },[player]);
  useEffect(()=>{
    if(active&&foreground)player.play();
    else{player.pause();player.muted=true;setMuted(true);}
    return()=>{player.pause();};
  },[active,foreground,player]);
  return <View style={{width:230,height,borderRadius:13,overflow:'hidden',backgroundColor:'#081421'}}>
    <Pressable accessibilityRole="button" accessibilityLabel="Открыть видео на весь экран" onPress={onOpen} style={{flex:1}}>
      <VideoView player={player} nativeControls={false} contentFit="contain" surfaceType="textureView" onFirstFrameRender={()=>setFirstFrame(true)} style={{width:'100%',height:'100%'}}/>
      {poster&&!firstFrame&&<Image pointerEvents="none" source={{uri:poster}} resizeMode="contain" onError={()=>setPoster(null)} style={{position:'absolute',left:0,right:0,top:0,bottom:0,width:'100%',height:'100%'}}/>}
      {failed&&<Text style={{position:'absolute',top:15,left:15,color:'#fff'}}>Видео недоступно</Text>}
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={muted?'Включить звук видео':'Выключить звук видео'}
      onPress={()=>{const next=!muted;player.muted=next;setMuted(next);if(!next&&active&&foreground)player.play();}}
      style={{position:'absolute',right:7,bottom:7,padding:8,borderRadius:20,backgroundColor:colors.surface}}>
      <Ionicons name={muted?'volume-mute':'volume-high'} color={colors.accent} size={20}/>
    </Pressable>
  </View>;
}

/** A paused decoded frame for a photo/video album, with no autoplay or audio. */
function DecodedVideoThumbnail({uri,colors}:{uri:string;colors:Palette}){
  const player=useVideoPlayer(uri,instance=>{instance.muted=true;instance.loop=false;});
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const load=player.addListener('sourceLoad',event=>{
      player.currentTime=Math.min(.2,Math.max(0,event.duration-.01));
      player.pause();
    });
    const status=player.addListener('statusChange',event=>setFailed(event.status==='error'));
    return()=>{load.remove();status.remove();};
  },[player]);
  return <View pointerEvents="none" style={{width:'100%',height:'100%'}}>
    {!failed&&<VideoView player={player} nativeControls={false} contentFit="cover" surfaceType="textureView" style={{width:'100%',height:'100%'}}/>}
    <View style={{position:'absolute',left:0,right:0,top:0,bottom:0,alignItems:'center',justifyContent:'center'}}>
      <Ionicons name="play-circle" size={34} color={failed?colors.accent:'#fff'}/>
    </View>
  </View>;
}

export function ConnectNativeVideoThumbnail({uri,path,colors}:{uri:string;path?:string;colors:Palette}){
  const [poster,setPoster]=useState<string|null>(null);
  const [resolved,setResolved]=useState(!path||!/__vid_\d{1,5}x\d{1,5}$/.test(path));
  useEffect(()=>{
    let alive=true;setPoster(null);
    if(!path||!/__vid_\d{1,5}x\d{1,5}$/.test(path)){setResolved(true);return;}
    setResolved(false);
    void signedObject('connect-attachments',path+'__poster.jpg').then(url=>{if(alive)setPoster(url);})
      .catch(()=>{}).finally(()=>{if(alive)setResolved(true);});
    return()=>{alive=false;};
  },[path]);
  if(!resolved)return <ActivityIndicator color={colors.accent}/>;
  if(!poster)return <DecodedVideoThumbnail uri={uri} colors={colors}/>;
  return <View pointerEvents="none" style={{width:'100%',height:'100%'}}>
    <Image source={{uri:poster}} resizeMode="cover" onError={()=>setPoster(null)} style={{width:'100%',height:'100%'}}/>
    <View style={{position:'absolute',left:0,right:0,top:0,bottom:0,alignItems:'center',justifyContent:'center'}}><Ionicons name="play-circle" size={34} color="#fff"/></View>
  </View>;
}

/** Circular playable video note, matching the PWA's filename contract. */
function VideoNoteBubble({uri,colors,active}:{uri:string;colors:Palette;active:boolean}) {
  const player=useVideoPlayer(uri,instance=>{instance.loop=true;});
  const [playing,setPlaying]=useState(false);
  const [muted,setMuted]=useState(true);
  const [duration,setDuration]=useState(0);
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const [manualPause,setManualPause]=useState(false);
  const soundMuted=useRef(true);
  useEffect(()=>{
    const sub=AppState.addEventListener('change',value=>setForeground(value==='active'));
    return()=>sub.remove();
  },[]);
  useEffect(()=>{
    if(!active||!foreground){
      player.pause();player.muted=true;soundMuted.current=true;setMuted(true);setPlaying(false);
      if(!active)setManualPause(false);
    }else if(!manualPause){
      player.muted=soundMuted.current;setMuted(soundMuted.current);
      player.play();setPlaying(true);
    }else{player.pause();setPlaying(false);}
    return()=>{player.pause();};
  },[active,foreground,manualPause,player]);
  useEffect(()=>{
    const update=()=>{if(player.duration>0&&Number.isFinite(player.duration))setDuration(player.duration);};
    update();const timer=setInterval(update,800);return()=>clearInterval(timer);
  },[player]);
  return <View style={{width:208,height:220}}>
    <Pressable accessibilityRole="button" accessibilityLabel={playing?'Пауза видеокружка':'Воспроизвести видеокружок'}
      onPress={()=>{if(playing){setManualPause(true);player.pause();setPlaying(false);}else{setManualPause(false);player.play();setPlaying(true);}}}
      style={{width:208,height:208,borderRadius:104,overflow:'hidden',backgroundColor:'#081421',borderWidth:2,borderColor:colors.accent}}>
      <VideoView player={player} nativeControls={false} contentFit="cover" surfaceType="textureView" style={{width:'100%',height:'100%'}} />
      {!playing&&<View pointerEvents="none" style={{position:'absolute',top:0,left:0,right:0,bottom:0,alignItems:'center',justifyContent:'center',backgroundColor:'#06101b44'}}>
        <Ionicons name="play-circle" size={52} color="#fff"/>
      </View>}
    </Pressable>
    {duration>0&&<Text style={{position:'absolute',bottom:0,left:8,fontSize:11,color:colors.text,backgroundColor:colors.surface,paddingHorizontal:7,paddingVertical:4,borderRadius:8}}>{audioClock(duration)}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={muted?'Включить звук видеокружка':'Выключить звук видеокружка'}
      onPress={()=>{const next=!muted;soundMuted.current=next;player.muted=next;setMuted(next);if(!next&&active&&foreground){setManualPause(false);player.play();setPlaying(true);}}}
      style={{position:'absolute',right:2,bottom:0,borderRadius:17,padding:8,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line}}>
      <Ionicons name={muted?'volume-mute':'volume-high'} size={19} color={colors.accent}/>
    </Pressable>
  </View>;
}

export function ConnectNativeMediaViewer({url,kind,title,onClose,colors,onPrevious,onNext,count,index}:{
  url:string|null;kind:'photos'|'videos';title:string;onClose:()=>void;colors:Palette;onPrevious?:()=>void;onNext?:()=>void;count?:number;index?:number;
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
        {!url?<ActivityIndicator accessibilityLabel="Загрузка медиа" color="#fff"/>:kind==='photos'?<Image key={url} source={{uri:url}} resizeMode="contain" style={{width:'100%',height:'85%'}}/>:<VideoClip key={url} uri={url}/>}
      </View>
      {Boolean(count && count>1)&&<View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:14}}>
        <IconButton name="chevron-back-circle" label="Предыдущий файл" onPress={()=>onPrevious?.()} colors={colors}/>
        <Text style={{color:'#fff'}}>{(index||0)+1} / {count}</Text>
        <IconButton name="chevron-forward-circle" label="Следующий файл" onPress={()=>onNext?.()} colors={colors}/>
      </View>}
      {url&&<View style={{alignItems:'center',paddingTop:8}}><SaveAttachment url={url} name={title}
        mime={({png:'image/png',webp:'image/webp',gif:'image/gif',jpg:'image/jpeg',jpeg:'image/jpeg',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'} as Record<string,string>)[fileExtension(title)]||'application/octet-stream'} colors={colors}/></View>}
    </View>
  </Modal>;
}
export type ConnectNativeGalleryItem={path:string;name:string;kind:'image'|'video'};
export function ConnectNativeAttachment({message,colors,videoAutoPlay=false,onOpenMedia}:{message:Message;colors:Palette;videoAutoPlay?:boolean;onOpenMedia?:(item:ConnectNativeGalleryItem)=>void}) {
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
  const open=(kind:'image'|'video')=>{
    if(onOpenMedia)onOpenMedia({path:message.attachment_path!,name,kind});
    else setView(true);
  };
  if(!url)return <Text style={{color:colors.muted}}>Загружаем вложение…</Text>;
  if(k==='image'&&/^sticker-\d+\.(?:png|webp|gif|jpe?g)$/i.test(name))
    return <Image source={{uri:url}} resizeMode="contain" style={{width:150,height:150}} accessibilityLabel="Стикер из клавиатуры"/>;
  if(k==='image')return <><Pressable accessibilityRole="button" accessibilityLabel={`Открыть фото ${name}`} onPress={()=>open('image')}>
      <AttachmentImage url={url}/>
    </Pressable><SaveAttachment url={url} name={name} mime={message.attachment_type||'image/jpeg'} colors={colors}/>
    {view&&<ConnectNativeMediaViewer url={url} kind="photos" title={name} onClose={()=>setView(false)} colors={colors}/>}</>;
  if(k==='video'&&/^connect-video-note-\d+\.(?:mp4|webm)$/i.test(name))return <View><VideoNoteBubble uri={url} colors={colors} active={videoAutoPlay}/><SaveAttachment url={url} name={name} mime={message.attachment_type||'video/mp4'} colors={colors}/></View>;
  if(k==='video')return <><ConnectNativeInlineVideo uri={url} path={message.attachment_path} colors={colors} active={videoAutoPlay&&!view} onOpen={()=>open('video')}/>
    <SaveAttachment url={url} name={name} mime={message.attachment_type||'video/mp4'} colors={colors}/>
    {view&&<ConnectNativeMediaViewer url={url} kind="videos" title={name} onClose={()=>setView(false)} colors={colors}/>}</>;
  if(k==='audio'||(message.attachment_type||'').startsWith('audio/'))return <View style={{maxWidth:255}}><Text numberOfLines={1} style={{color:colors.text}}>{name}</Text><AudioClip uri={url} colors={colors}/><SaveAttachment url={url} name={name} mime={message.attachment_type||'audio/mpeg'} colors={colors}/></View>;
  return <View><Pressable onPress={()=>void Linking.openURL(url).catch(()=>Alert.alert('Не удалось открыть файл'))} style={{flexDirection:'row',alignItems:'center',gap:8}}>
    <Ionicons name="document-attach-outline" size={22} color={colors.accent}/><Text numberOfLines={2} style={{color:colors.text,flexShrink:1}}>{name}</Text>
  </Pressable><SaveAttachment url={url} name={name} mime={message.attachment_type||'application/octet-stream'} colors={colors}/></View>;
}

export default function ConnectNativeMedia({ownerId,kind,owner,onBack,colors,onAvatarUpdated}:{ownerId:string;kind:MediaKind;owner:boolean;onBack:()=>void;colors:Palette;onAvatarUpdated?:()=>Promise<void>}) {
  const [items,setItems]=useState<ListedMedia[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<number|null>(null);
  const [uploadProgress,setUploadProgress]=useState('');
  const [avatarSource,setAvatarSource]=useState<AvatarSource|null>(null);
  const style=useMemo(()=>c(colors),[colors]);
  const label=owner?{photos:'Мои фото',videos:'Мои видео',music:'Моя музыка'}[kind]:{photos:'Фото',videos:'Видео',music:'Музыка'}[kind];
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
        const pick=await DocumentPicker.getDocumentAsync({type:'audio/*',multiple:true,copyToCacheDirectory:true});
        if(!pick.canceled)files=pick.assets.map(a=>({uri:a.uri,name:a.name,mime:a.mimeType||'audio/mpeg',size:a.size}));
      }else{
        const pick=await ImagePicker.launchImageLibraryAsync({mediaTypes:kind==='photos'?['images' as const]:['videos' as const],allowsMultipleSelection:true,quality:1});
        if(!pick.canceled)files=pick.assets.map(a=>({uri:a.uri,name:a.fileName||`${kind}-${Date.now()}.${kind==='photos'?'jpg':'mp4'}`,mime:a.mimeType||(kind==='photos'?'image/jpeg':'video/mp4'),size:a.fileSize}));
      }
      if(!files.length)return;
      if(files.length>12)throw Error('За один раз можно добавить не более 12 файлов');
      const formats:{[K in MediaKind]:string[]}={
        photos:['jpg','jpeg','png','webp','gif'],
        videos:['mp4','mov','webm'],
        music:['mp3','m4a','aac','wav','ogg','opus','flac','webm'],
      };
      for(const file of files){
        if(!formats[kind].includes(fileExtension(file.name)))throw Error(`Формат файла не поддерживается: ${file.name}`);
      }
      setBusy(true);
      for(let i=0;i<files.length;i++){
        const file=files[i];
        if(!fileExtension(file.name))throw Error('Неизвестный формат файла');
        const path=`${ownerId}/${kind}/${nameForStorage(file.name)}`;
        await uploadFile('connect-profile-media',path,file,(sent,total)=>{
          setUploadProgress(`Загружаем ${i+1}/${files.length}: ${total?Math.min(100,Math.round(sent/total*100)):0}%`);
        });
      }
      await reload();
    }catch(e){Alert.alert('Не удалось загрузить',e instanceof Error?e.message:String(e));}
    finally{setBusy(false);setUploadProgress('');}
  }
  async function makeAvatar(item:ListedMedia){
    if(!owner||busy||kind!=='photos')return;
    const ext=fileExtension(item.name);
    if(!['jpg','jpeg','png','webp'].includes(ext)){
      Alert.alert('Не подходит для аватара','Выбери JPG, PNG или WebP.');return;
    }
    if(!FileSystem.cacheDirectory){Alert.alert('Ошибка','Кэш телефона недоступен');return;}
    setBusy(true);
    try{
      const saved=await FileSystem.downloadAsync(item.url,FileSystem.cacheDirectory+`connect-crop-${Date.now()}.${ext}`);
      if(saved.status!==200)throw Error('Не удалось загрузить фотографию');
      const size=new File(saved.uri).size;
      if(!size||size>12*1024*1024)throw Error('Фото должно быть не более 12 МБ.');
      const image=await new Promise<{width:number;height:number}>((resolve,reject)=>{
        Image.getSize(saved.uri,(width,height)=>resolve({width,height}),reject);
      });
      setAvatarSource({uri:saved.uri,width:image.width,height:image.height});
    }catch(e){Alert.alert('Не удалось открыть редактор',e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function saveCroppedGalleryAvatar(file:CroppedAvatar){
    setBusy(true);
    try{
      const path=`${ownerId}/avatar-${Date.now()}.jpg`;
      await uploadFile('connect-avatars',path,{uri:file.uri,name:'avatar.jpg',mime:'image/jpeg',size:file.size});
      const result=await db.from('profiles').update({avatar_path:path}).eq('id',ownerId);
      if(result.error)throw result.error;
      await onAvatarUpdated?.();
      setAvatarSource(null);
      Alert.alert('Готово','Фотография установлена на аватар.');
    }finally{setBusy(false);}
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
    {uploadProgress!==''&&<Text style={{fontSize:12,color:colors.accent,paddingHorizontal:16,paddingVertical:5}}>{uploadProgress}</Text>}
    {loading?<ActivityIndicator style={{marginTop:40}} color={colors.accent}/>:<ScrollView contentContainerStyle={{padding:14,paddingBottom:36}}>
      {Boolean(error)&&<Text style={{color:colors.danger,marginBottom:12}}>{error}</Text>}
      {kind==='music'?<>{!items.length&&<Text style={style.muted}>Здесь пока нет файлов.</Text>}<ConnectNativeMusicLibrary ownerId={ownerId} items={items} isOwner={owner} busy={busy} onRemove={deleteMedia} colors={colors}/></>:
        !items.length?<Text style={style.muted}>Здесь пока нет файлов.</Text>:kind==='photos'?<View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:10}}>
          {items.map((item,i)=><View key={item.path} style={{width:'32%',gap:4}}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Открыть фото ${item.name}`} onPress={()=>setSelected(i)}>
              <Image source={{uri:item.url}} style={{width:'100%',aspectRatio:1,borderRadius:10,backgroundColor:colors.elevated}}/>
            </Pressable>
            <Text numberOfLines={1} style={style.muted}>{item.name}</Text>
            {owner&&<View style={{flexDirection:'row',justifyContent:'space-between'}}>
              {['jpg','jpeg','png','webp'].includes(fileExtension(item.name))&&<IconButton name="person-circle-outline" label={`Установить ${item.name} на аватар`} colors={colors} onPress={()=>void makeAvatar(item)}/>}
              <IconButton name="trash-outline" label={`Удалить ${item.name}`} colors={colors} onPress={()=>deleteMedia(item)}/>
            </View>}
          </View>)}
        </View>:items.map((item,i)=><View key={item.path} style={[style.card,style.row]}>
          <Pressable onPress={()=>setSelected(i)} style={{flex:1,flexDirection:'row',alignItems:'center',gap:11}} accessibilityRole="button">
            <View style={{width:88,height:66,borderRadius:9,overflow:'hidden',backgroundColor:colors.elevated}}><ConnectNativeVideoThumbnail uri={item.url} colors={colors}/></View>
            <View style={{flex:1}}><Text style={style.text} numberOfLines={2}>{item.name}</Text>
              <Text style={style.muted}>{item.size?`${(item.size/1024/1024).toFixed(1)} МБ`:label}</Text></View>
          </Pressable>
          {owner&&<IconButton name="trash-outline" label={`Удалить ${item.name}`} colors={colors} onPress={()=>deleteMedia(item)}/>}
        </View>)}
      <Text style={[style.muted,{marginTop:12}]}>Файлы видны участникам Connect. Пока доступна загрузка до {DIRECT_UPLOAD_LIMIT/1024/1024} МБ за файл.</Text>
    </ScrollView>}
    <ConnectNativeAvatarCropper source={avatarSource} colors={colors} busy={busy} onClose={()=>setAvatarSource(null)} onSave={saveCroppedGalleryAvatar}/>
    {validViewer && active&&<ConnectNativeMediaViewer key={active.path} url={active.url} title={active.name} kind={kind as 'photos'|'videos'} colors={colors}
      count={items.length} index={selected||0} onClose={()=>setSelected(null)}
      onPrevious={()=>setSelected(x=>x===null?null:(x-1+items.length)%items.length)}
      onNext={()=>setSelected(x=>x===null?null:(x+1)%items.length)}/>}
  </View>;
}
