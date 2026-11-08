/** Connect PWA music queue, playback, mini-player and opt-in now-playing presence.
 * Tracks live in the existing connect-profile-media Supabase Storage bucket.
 * This module never uploads audio or creates an APK.
 */
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as SecureStore from 'expo-secure-store';
import {setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus} from 'expo-audio';
import {db} from './backend';
import type {ListedMedia} from './nativeMediaUtils';
import type {Palette} from './theme';

type Track = Pick<ListedMedia, 'path'|'name'|'url'>;
type Saved = {ownerId:string;path:string;position:number;shuffle:boolean;repeat:boolean;muted:boolean};
type MusicContextValue = {
  ownerId:string|null; tracks:Track[]; current:Track|null; playing:boolean;
  position:number; duration:number; shuffle:boolean; repeat:boolean; muted:boolean;
  libraryOpen:boolean; ready:boolean; isPublic:boolean; shareReady:boolean; shareError:string;
  registerQueue:(id:string,songs:Track[])=>void;
  select:(song:Track)=>void; toggle:()=>void; adjacent:(direction:1|-1,automatic?:boolean)=>void;
  seek:(position:number)=>void; setShuffle:(enabled:boolean)=>void; setRepeat:(enabled:boolean)=>void;
  setMuted:(enabled:boolean)=>void; setLibraryOpen:(open:boolean)=>void;
  setUser:(id:string)=>void; setPublic:(enabled:boolean)=>void; close:()=>void;
};
const MusicContext=createContext<MusicContextValue|null>(null);
const STORAGE_KEY='connect-native-music-playback-v1';
const clock=(seconds:number)=>{
  const n=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));
  return `${Math.floor(n/60).toString().padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
};
export function useConnectNativeMusic(){
  const value=useContext(MusicContext);
  if(!value)throw new Error('Music provider not mounted');
  return value;
}
export function ConnectNativeMusicProvider({children}:{children:React.ReactNode}){
  const player=useAudioPlayer(null,{updateInterval:250});
  const status=useAudioPlayerStatus(player);
  const [ready,setReady]=useState(false);
  const [ownerId,setOwnerId]=useState<string|null>(null);
  const [tracks,setTracks]=useState<Track[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [shuffle,setShuffle]=useState(false);
  const [repeat,setRepeat]=useState(false);
  const [muted,setMuted]=useState(false);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [userId,setUserId]=useState('');
  const [isPublic,setIsPublic]=useState(false);
  const [shareReady,setShareReady]=useState(false);
  const [shareError,setShareError]=useState('');
  const savedRef=useRef<Saved|null>(null);
  const resumeRef=useRef<{path:string;position:number}|null>(null);
  const ownerRef=useRef<string|null>(null);
  const trackRef=useRef<string|null>(null);
  const queueRef=useRef<Track[]>([]);
  const repeatRef=useRef(false);
  const shuffleRef=useRef(false);
  const persistedAt=useRef(0);
  const current=useMemo(()=>tracks.find(t=>t.path===selected)||null,[tracks,selected]);
  const duration=Math.max(0,status.duration||0);
  const position=Math.max(0,Math.min(duration||Infinity,status.currentTime||0));
  const playing=Boolean(status.playing);

  useEffect(()=>{let live=true;
    void SecureStore.getItemAsync(STORAGE_KEY).then(raw=>{
      if(!live)return;
      try{
        const saved=raw?JSON.parse(raw) as Partial<Saved>:null;
        if(saved&&typeof saved.ownerId==='string'&&typeof saved.path==='string'){
          const normalized:Saved={ownerId:saved.ownerId,path:saved.path,position:Math.max(0,Number(saved.position)||0),shuffle:saved.shuffle===true,repeat:saved.repeat===true,muted:saved.muted===true};
          savedRef.current=normalized;setShuffle(normalized.shuffle);setRepeat(normalized.repeat);setMuted(normalized.muted);
        }
      }catch{/* Ignore corrupt local preferences. */}
    }).finally(()=>{if(live)setReady(true);});
    return()=>{live=false;};
  },[]);
  useEffect(()=>{repeatRef.current=repeat;shuffleRef.current=shuffle;},[repeat,shuffle]);
  useEffect(()=>{player.muted=muted;},[player,muted]);

  const applySong=useCallback((song:Track,autoplay:boolean,at=0)=>{
    trackRef.current=song.path;
    setSelected(song.path);
    resumeRef.current=at>0?{path:song.path,position:at}:null;
    player.pause();
    player.replace(song.url);
    if(autoplay){
      void setAudioModeAsync({playsInSilentMode:true,shouldPlayInBackground:true,interruptionMode:'doNotMix'}).then(()=>{
        player.setActiveForLockScreen(true,{title:song.name,artist:'Connect'});
        player.play();
      }).catch(()=>player.play());
    }
  },[player]);
  const registerQueue=useCallback((id:string,songs:Track[])=>{
    if(!ready||!id)return;
    queueRef.current=songs;
    setTracks(songs);
    if(ownerRef.current===id&&trackRef.current&&songs.some(t=>t.path===trackRef.current))return;
    ownerRef.current=id;
    setOwnerId(id);
    const saved=savedRef.current;
    const wanted=saved?.ownerId===id?songs.find(t=>t.path===saved.path):undefined;
    const song=wanted||songs[0];
    if(!song){player.pause();trackRef.current=null;setSelected(null);return;}
    applySong(song,false,wanted?saved?.position||0:0);
  },[ready,player,applySong]);
  useEffect(()=>{
    const resume=resumeRef.current;
    if(status.isLoaded&&resume&&resume.path===trackRef.current){
      resumeRef.current=null;
      void player.seekTo(Math.min(resume.position,Math.max(0,duration-0.2)));
    }
  },[status.isLoaded,duration,player,selected]);
  const select=useCallback((song:Track)=>{
    if(!queueRef.current.some(t=>t.path===song.path))return;
    if(trackRef.current===song.path){
      void setAudioModeAsync({playsInSilentMode:true,shouldPlayInBackground:true,interruptionMode:'doNotMix'}).then(()=>{
        player.setActiveForLockScreen(true,{title:song.name,artist:'Connect'});player.play();
      }).catch(()=>player.play());
      return;
    }
    applySong(song,true);
  },[player,applySong]);
  const toggle=useCallback(()=>{
    if(status.playing){player.pause();return;}
    const song=queueRef.current.find(t=>t.path===trackRef.current);
    if(!song)return;
    void setAudioModeAsync({playsInSilentMode:true,shouldPlayInBackground:true,interruptionMode:'doNotMix'}).then(()=>{
      player.setActiveForLockScreen(true,{title:song.name,artist:'Connect'});
      player.play();
    }).catch(()=>player.play());
  },[player,status.playing]);
  const adjacent=useCallback((dir:1|-1,automatic=false)=>{
    const songs=queueRef.current;
    if(!songs.length)return;
    const index=Math.max(0,songs.findIndex(t=>t.path===trackRef.current));
    if(automatic&&songs.length===1&&!repeatRef.current){player.pause();return;}
    if(automatic&&dir===1&&!repeatRef.current&&!shuffleRef.current&&index===songs.length-1){player.pause();return;}
    if(!automatic&&dir===-1&&player.currentTime>3){void player.seekTo(0);return;}
    let next=(index+dir+songs.length)%songs.length;
    if(shuffleRef.current&&songs.length>1){
      const available=songs.map((_,i)=>i).filter(i=>i!==index);
      next=available[Math.floor(Math.random()*available.length)];
    }
    const song=songs[next];
    if(song.path===trackRef.current){void player.seekTo(0).then(()=>player.play()).catch(()=>player.play());}
    else applySong(song,true);
  },[player,applySong]);
  useEffect(()=>{if(status.didJustFinish)adjacent(1,true);},[status.didJustFinish,adjacent]);
  const seek=useCallback((time:number)=>{if(Number.isFinite(time)&&time>=0&&player.duration>0)void player.seekTo(Math.min(time,player.duration));},[player]);
  const close=useCallback(()=>{
    player.pause();player.setActiveForLockScreen(false);
    ownerRef.current=null;trackRef.current=null;queueRef.current=[];resumeRef.current=null;
    setOwnerId(null);setTracks([]);setSelected(null);
    savedRef.current=null;
    void SecureStore.deleteItemAsync(STORAGE_KEY).catch(()=>{});
  },[player]);
  const setUser=useCallback((id:string)=>setUserId(old=>old===id?old:id),[]);
  const setPublic=useCallback((enabled:boolean)=>setIsPublic(enabled),[]);
  useEffect(()=>{let active=true;
    setShareReady(false);setShareError('');setIsPublic(false);
    if(!userId)return()=>{active=false;};
    void Promise.resolve(db.from('connect_music_presence').select('is_public').eq('owner_id',userId).maybeSingle()).then(({data,error})=>{
      if(!active)return;
      if(error){setShareError('Не удалось получить настройки видимости музыки.');return;}
      setIsPublic(data?.is_public===true);setShareReady(true);
    }).catch(()=>{if(active)setShareError('Ошибка загрузки настройки музыки.');});
    return()=>{active=false;};
  },[userId]);
  useEffect(()=>{
    if(!userId||!shareReady)return;
    let live=true;
    const publish=async()=>{
      const result=await db.from('connect_music_presence').upsert({
        owner_id:userId,is_public:isPublic,is_playing:isPublic&&playing&&Boolean(current),
        track_name:isPublic&&playing?current?.name||'':'',updated_at:new Date().toISOString(),
      },{onConflict:'owner_id'});
      if(live)setShareError(result.error?'Не удалось обновить статус: '+result.error.message:'');
    };
    void publish().catch(()=>{if(live)setShareError('Не удалось обновить статус музыки.');});
    const timer=setInterval(()=>{if(isPublic&&playing)void publish().catch(()=>{});},45000);
    return()=>{live=false;clearInterval(timer);};
  },[userId,isPublic,shareReady,playing,current?.path,current?.name]);
  useEffect(()=>{
    if(!ready||!ownerId||!selected)return;
    const now=Date.now();
    if(playing&&now-persistedAt.current<7000)return;
    persistedAt.current=now;
    const saved:Saved={ownerId,path:selected,position,shuffle,repeat,muted};
    savedRef.current=saved;
    void SecureStore.setItemAsync(STORAGE_KEY,JSON.stringify(saved)).catch(()=>{});
  },[ready,ownerId,selected,position,playing,shuffle,repeat,muted]);
  const value:MusicContextValue={ownerId,tracks,current,playing,position,duration,shuffle,repeat,muted,libraryOpen,ready,isPublic,shareReady,shareError,
    registerQueue,select,toggle,adjacent,seek,setShuffle,setRepeat,setMuted,setLibraryOpen,setUser,setPublic,close};
  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}
function Control({name,label,onPress,colors,active=false}:{name:keyof typeof Ionicons.glyphMap;label:string;onPress:()=>void;colors:Palette;active?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{padding:9,borderRadius:12,backgroundColor:active?colors.elevated:'transparent'}}>
    <Ionicons name={name} size={23} color={active?colors.accent:colors.text}/>
  </Pressable>;
}
function Progress({colors}:{colors:Palette}){
  const m=useConnectNativeMusic();
  const [barWidth,setBarWidth]=useState(1);
  const progress=m.duration?m.position/m.duration:0;
  return <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
    <Text style={{fontSize:11,color:colors.muted}}>{clock(m.position)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Перемотать трек" disabled={!m.duration} onLayout={e=>setBarWidth(Math.max(1,e.nativeEvent.layout.width))}
      onPress={e=>m.seek((e.nativeEvent.locationX/barWidth)*m.duration)} style={{flex:1,height:27,justifyContent:'center'}}>
      <View pointerEvents="none" style={{height:5,backgroundColor:colors.line,borderRadius:5,overflow:'hidden'}}>
        <View style={{width:Math.round(progress*barWidth),height:5,backgroundColor:colors.accent}}/>
      </View>
    </Pressable>
    <Text style={{fontSize:11,color:colors.muted}}>{clock(m.duration)}</Text>
  </View>;
}
export function ConnectNativeMusicLibrary({ownerId,items,isOwner,busy,onRemove,colors}:{ownerId:string;items:ListedMedia[];isOwner:boolean;busy:boolean;onRemove:(item:ListedMedia)=>void;colors:Palette}){
  const m=useConnectNativeMusic();
  useEffect(()=>{m.setLibraryOpen(true);return()=>m.setLibraryOpen(false);},[m.setLibraryOpen]);
  useEffect(()=>{if(m.ready)m.registerQueue(ownerId,items);},[m.ready,m.registerQueue,ownerId,items]);
  const sameOwner=m.ownerId===ownerId;
  return <View style={{gap:13}}>
    {sameOwner&&m.current&&<View style={{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:19,padding:15,gap:10}}>
      <Text numberOfLines={2} style={{color:colors.text,fontSize:16,fontWeight:'700',textAlign:'center'}}>{m.current.name}</Text>
      <Progress colors={colors}/>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-around'}}>
        <Control name="shuffle" label="Случайный порядок" colors={colors} active={m.shuffle} onPress={()=>m.setShuffle(!m.shuffle)}/>
        <Control name="play-skip-back" label="Предыдущая композиция" colors={colors} onPress={()=>m.adjacent(-1)}/>
        <Control name={m.playing?'pause-circle':'play-circle'} label={m.playing?'Пауза':'Воспроизвести'} colors={colors} onPress={m.toggle}/>
        <Control name="play-skip-forward" label="Следующая композиция" colors={colors} onPress={()=>m.adjacent(1)}/>
        <Control name="repeat" label="Повтор плейлиста" colors={colors} active={m.repeat} onPress={()=>m.setRepeat(!m.repeat)}/>
        <Control name={m.muted?'volume-mute':'volume-high'} label={m.muted?'Включить звук':'Выключить звук'} colors={colors} onPress={()=>m.setMuted(!m.muted)}/>
      </View>
    </View>}
    {items.map((song,i)=><View key={song.path} style={{flexDirection:'row',alignItems:'center',gap:7,borderColor:colors.line,borderWidth:1,borderRadius:15,padding:8,backgroundColor:colors.surface}}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Воспроизвести ${song.name}`} onPress={()=>m.select(song)} style={{flex:1,flexDirection:'row',alignItems:'center',gap:10,padding:6}}>
        <Ionicons name={sameOwner&&m.current?.path===song.path&&m.playing?'musical-note':'play'} color={colors.accent} size={23}/>
        <View style={{flex:1}}><Text numberOfLines={2} style={{color:colors.text,fontSize:14,fontWeight:'600'}}>{song.name}</Text>
          <Text style={{color:colors.muted,fontSize:11}}>Трек {i+1}</Text></View>
      </Pressable>
      {isOwner&&<Control name="trash-outline" label={`Удалить ${song.name}`} onPress={()=>onRemove(song)} colors={colors}/>}
    </View>)}
    {isOwner&&<View style={{padding:13,borderWidth:1,borderColor:colors.line,borderRadius:13,gap:6}}>
      <Pressable accessibilityRole="switch" accessibilityState={{checked:m.isPublic,disabled:!m.shareReady||busy}} disabled={!m.shareReady||busy}
        onPress={()=>m.setPublic(!m.isPublic)} style={{flexDirection:'row',alignItems:'center',gap:10}}>
        <Ionicons name={m.isPublic?'checkbox':'square-outline'} size={22} color={colors.accent}/>
        <Text style={{flex:1,color:colors.text,fontWeight:'600'}}>Показывать «Сейчас слушает»</Text>
      </Pressable>
      <Text style={{fontSize:11,color:colors.muted}}>По умолчанию выключено. Другие видят музыку только во время воспроизведения.</Text>
      {!!m.shareError&&<Text style={{fontSize:11,color:colors.danger}}>{m.shareError}</Text>}
    </View>}
  </View>;
}
export function ConnectNativeMusicMiniPlayer({colors,onOpen}:{colors:Palette;onOpen:(ownerId:string)=>void}){
  const m=useConnectNativeMusic();
  if(!m.current||!m.ownerId||m.libraryOpen)return null;
  return <View style={{marginHorizontal:12,marginBottom:6,paddingHorizontal:7,paddingVertical:5,borderRadius:17,backgroundColor:colors.elevated,borderWidth:1,borderColor:colors.line,
    flexDirection:'row',alignItems:'center'}}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Открыть музыку ${m.current.name}`} onPress={()=>onOpen(m.ownerId!)} style={{flex:1,flexDirection:'row',alignItems:'center',gap:6,padding:7}}>
      <Ionicons name="musical-notes" color={colors.accent} size={19}/>
      <Text numberOfLines={1} style={{color:colors.text,fontWeight:'600',flex:1}}>{m.current.name}</Text>
    </Pressable>
    <Control name="play-skip-back" label="Предыдущий трек" colors={colors} onPress={()=>m.adjacent(-1)}/>
    <Control name={m.playing?'pause':'play'} label={m.playing?'Пауза':'Играть'} colors={colors} onPress={m.toggle}/>
    <Control name="play-skip-forward" label="Следующий трек" colors={colors} onPress={()=>m.adjacent(1)}/>
    <Control name="close" label="Закрыть мини-плеер" colors={colors} onPress={m.close}/>
  </View>;
}
export function ConnectNativeNowListening({profileId,colors}:{profileId:string;colors:Palette}){
  const [song,setSong]=useState<string|null>(null);
  useEffect(()=>{let alive=true;
    const refresh=async()=>{
      const {data,error}=await db.from('connect_music_presence').select('track_name,updated_at,is_playing,is_public').eq('owner_id',profileId).maybeSingle();
      const fresh=data?.updated_at&&Date.now()-Date.parse(data.updated_at)<150000;
      if(alive)setSong(!error&&fresh&&data?.is_public&&data?.is_playing&&data?.track_name?String(data.track_name):null);
    };
    void refresh().catch(()=>{});const timer=setInterval(()=>void refresh().catch(()=>{}),45000);
    return()=>{alive=false;clearInterval(timer);};
  },[profileId]);
  return song?<View style={{flexDirection:'row',alignItems:'center',gap:7,paddingVertical:5}}>
    <Ionicons name="musical-notes-outline" color={colors.accent} size={16}/>
    <Text numberOfLines={2} style={{color:colors.muted,fontSize:12}}>Сейчас слушает: {song}</Text>
  </View>:null;
}
