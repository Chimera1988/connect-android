'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ConnectMusicTrack = { path: string; name: string; url: string };
type Persisted = { ownerId: string; path: string; position: number; shuffle: boolean; repeat: boolean; volume: number; muted: boolean };
type MusicApi = {
  ownerId: string | null; tracks: ConnectMusicTrack[]; current: ConnectMusicTrack | null;
  playing: boolean; position: number; duration: number; shuffle: boolean; repeat: boolean;
  volume: number; muted: boolean; shareNowPlaying: boolean; shareLoaded: boolean; shareError: string;
  registerPlaylist: (ownerId: string, tracks: ConnectMusicTrack[]) => void;
  registerClient: (client: SupabaseClient) => void;
  select: (track: ConnectMusicTrack) => void; toggle: () => void;
  adjacent: (direction: 1 | -1, automatic?: boolean) => void; seek: (seconds: number) => void;
  setShuffle: (value: boolean) => void; setRepeat: (value: boolean) => void;
  setVolume: (value: number) => void; setMuted: (value: boolean) => void;
  setMusicPageOpen: (open: boolean) => void; setShareNowPlaying: (value: boolean) => void;
};
const MusicContext = createContext<MusicApi | null>(null);
function useMusic() {
  const api = useContext(MusicContext);
  if (!api) throw new Error('Connect music player provider is not mounted');
  return api;
}
function readLast(): Persisted | null {
  try {
    const raw = localStorage.getItem('connect-profile-music-playback-v1');
    if (!raw) return null;
    const obj = JSON.parse(raw) as Partial<Persisted>;
    if (typeof obj.ownerId !== 'string' || typeof obj.path !== 'string') return null;
    return {
      ownerId:obj.ownerId, path:obj.path, position:Number(obj.position)||0,
      shuffle: obj.shuffle === true, repeat:obj.repeat === true,
      volume:typeof obj.volume === 'number' ? Math.max(0,Math.min(1,obj.volume)) : .85,
      muted: obj.muted === true,
    };
  } catch { return null; }
}
function icon(name: 'shuffle'|'previous'|'play'|'pause'|'next'|'repeat'|'volume'|'mute'|'close'|'more'|'music', size = 21) {
  const paths: Record<typeof name, ReactNode> = {
    shuffle:<><path d="m16 3 5 0v5M4 20l7-7M14 10l7-7M4 4l6 6m4 4 7 7m-5 0h5v-5"/></>,
    previous:<><path d="M5 5v14"/><path d="m19 5-13 7 13 7z" fill="currentColor" stroke="none"/></>,
    play:<path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/>,
    pause:<><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/></>,
    next:<><path d="M19 5v14"/><path d="M5 5 18 12 5 19z" fill="currentColor" stroke="none"/></>,
    repeat:<><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></>,
    volume:<><path d="M4 9h4l5-4v14l-5-4H4zM17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12"/></>,
    mute:<><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6"/></>,
    close:<path d="M5 5l14 14M19 5 5 19"/>,
    more:<><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></>,
    music:<><path d="M8 18V5l11-2v13M8 18c0 3-6 4-6 1s6-4 6-1ZM19 16c0 3-6 4-6 1s6-4 6-1Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function clock(value: number) {
  const n=Math.max(0,Number.isFinite(value)?Math.floor(value):0);
  return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;
}

export function ConnectMusicProvider({children}:{children:ReactNode}) {
  const audioRef=useRef<HTMLAudioElement>(null);
  const clientRef=useRef<SupabaseClient|null>(null);
  const lastRef=useRef<Persisted|null>(null);
  const restoreRef=useRef<{path:string;position:number}|null>(null);
  const ownerRef=useRef<string|null>(null);
  const selectedRef=useRef<string|null>(null);
  const queueRef=useRef<ConnectMusicTrack[]>([]);
  const persistRef=useRef(0);
  const [ownerId,setOwnerId]=useState<string|null>(null);
  const [tracks,setTracks]=useState<ConnectMusicTrack[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [playing,setPlaying]=useState(false);
  const [position,setPosition]=useState(0);
  const [duration,setDuration]=useState(0);
  const [shuffle,setShuffle]=useState(false);
  const [repeat,setRepeat]=useState(false);
  const [volume,setVolume]=useState(.85);
  const [muted,setMuted]=useState(false);
  const [musicPageOpen,setMusicPageOpen]=useState(false);
  const [miniBottom,setMiniBottom]=useState(112);
  const miniBottomRef=useRef(112);
  const miniDrag=useRef<{pointerId:number;startY:number;startBottom:number}|null>(null);
  const [shell,setShell]=useState<Element|null>(null);
  const [listenerId,setListenerId]=useState<string|null>(null);
  const [shareNowPlaying,setShareNowPlaying]=useState(false);
  const [shareLoaded,setShareLoaded]=useState(false);
  const [shareError,setShareError]=useState('');
  const current=useMemo(()=>tracks.find(t=>t.path===selected)||null,[tracks,selected]);

  useEffect(()=>{
    const saved=readLast(); lastRef.current=saved;
    if(saved){setShuffle(saved.shuffle);setRepeat(saved.repeat);setVolume(saved.volume);setMuted(saved.muted);}
  },[]);
  useEffect(()=>{
    const scan=()=>setShell(current=>{const next=document.querySelector('.connect-app');return current===next?current:next;});
    scan();
    const observer=new MutationObserver(scan);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{const audio=audioRef.current;if(audio){audio.volume=volume;audio.muted=muted;}},[volume,muted]);
  useEffect(()=>{
    try{
      const saved=Number(localStorage.getItem('connect-music-mini-bottom-v1'));
      if(Number.isFinite(saved)&&saved>=108){
        const bottom=Math.min(saved,Math.max(108,window.innerHeight-128));
        miniBottomRef.current=bottom;setMiniBottom(bottom);
      }
    }catch{/* Default location if localStorage is unavailable. */}
  },[]);

  const registerPlaylist=useCallback((id:string,list:ConnectMusicTrack[])=>{
    const sameOwner=ownerRef.current===id;
    ownerRef.current=id; queueRef.current=list;
    setOwnerId(id);setTracks(list);
    const old=selectedRef.current;
    if(!sameOwner || !old || !list.some(s=>s.path===old)){
      const saved=lastRef.current;
      const chosen=(saved?.ownerId===id && list.some(s=>s.path===saved.path)) ? saved.path : (list[0]?.path||null);
      selectedRef.current=chosen;setSelected(chosen);
      setPlaying(false);setDuration(0);
      const wanted=saved?.ownerId===id && chosen===saved.path ? saved.position : 0;
      setPosition(wanted);
      restoreRef.current=chosen?{path:chosen,position:wanted}:null;
      const audio=audioRef.current;
      if(audio){ audio.pause();audio.src=list.find(s=>s.path===chosen)?.url||'';audio.load(); }
    }
  },[]);
  const registerClient=useCallback((client:SupabaseClient)=>{
    if(clientRef.current===client && listenerId)return;
    clientRef.current=client;
    void client.auth.getUser().then(async ({data})=>{
      const id=data.user?.id || null;
      if(!id)return;
      if(id!==listenerId){setListenerId(id);setShareLoaded(false);setShareError('');
        const result=await client.from('connect_music_presence').select('is_public').eq('owner_id',id).maybeSingle();
        if(result.error){setShareError('Не удалось загрузить настройку видимости музыки.');setShareLoaded(false);return;}
        setShareNowPlaying(result.data?.is_public===true);setShareLoaded(true);
      }
    }).catch(()=>{setShareError('Не удалось проверить учётную запись.');});
  },[listenerId]);

  const safePlay=useCallback(()=>{
    const audio=audioRef.current;
    if(!audio||!audio.src)return;
    void audio.play().catch(()=>setPlaying(false));
  },[]);
  const selectTrack=useCallback((song:ConnectMusicTrack)=>{
    if(!queueRef.current.some(t=>t.path===song.path))return;
    const audio=audioRef.current;
    if(selectedRef.current!==song.path){
      selectedRef.current=song.path;setSelected(song.path);setPosition(0);setDuration(0);
      restoreRef.current=null;
      if(audio){audio.src=song.url;audio.load();}
    } else if(audio?.ended){audio.currentTime=0;}
    safePlay();
  },[safePlay]);
  const toggle=useCallback(()=>{
    const audio=audioRef.current;
    if(!audio)return;
    if(!audio.paused){audio.pause();return;}
    safePlay();
  },[safePlay]);
  const adjacent=useCallback((dir:1|-1,automatic=false)=>{
    const list=queueRef.current;
    if(!list.length)return;
    const index=Math.max(0,list.findIndex(s=>s.path===selectedRef.current));
    const audio=audioRef.current;
    if(automatic && !repeat && !shuffle && index===list.length-1){setPlaying(false);return;}
    if(automatic && list.length===1 && !repeat){setPlaying(false);return;}
    if(!automatic && dir===-1 && audio && audio.currentTime>3){audio.currentTime=0;return;}
    let next=(index+dir+list.length)%list.length;
    if(shuffle && list.length>1){const choices=list.map((_,i)=>i).filter(i=>i!==index);next=choices[Math.floor(Math.random()*choices.length)];}
    const song=list[next];
    if(song.path===selectedRef.current){if(audio){audio.currentTime=0;safePlay();}}
    else selectTrack(song);
  },[repeat,shuffle,selectTrack,safePlay]);
  const seek=useCallback((n:number)=>{
    const audio=audioRef.current;
    if(!audio||!Number.isFinite(audio.duration))return;
    audio.currentTime=Math.max(0,Math.min(n,audio.duration));setPosition(audio.currentTime);
  },[]);

  const savePlayback=useCallback((at:number)=>{
    if(!ownerRef.current||!selectedRef.current)return;
    const saved:Persisted={ownerId:ownerRef.current,path:selectedRef.current,position:at,shuffle,repeat,volume,muted};
    lastRef.current=saved;
    try{localStorage.setItem('connect-profile-music-playback-v1',JSON.stringify(saved));}catch{/* Storage can be unavailable. */}
  },[shuffle,repeat,volume,muted]);
  useEffect(()=>{if(ownerId && selected)savePlayback(position);},[ownerId,selected,shuffle,repeat,volume,muted,savePlayback]);
  useEffect(()=>{
    if(!shareLoaded || !listenerId || !clientRef.current)return;
    let active=true;
    const write=async()=>{
      if(!active||!clientRef.current)return;
      const {error}=await clientRef.current.from('connect_music_presence').upsert({
        owner_id:listenerId,is_public:shareNowPlaying,
        is_playing:shareNowPlaying && playing && Boolean(current),
        track_name:shareNowPlaying && playing ? (current?.name || '') : '',
        updated_at:new Date().toISOString(),
      },{onConflict:'owner_id'});
      if(active && error)setShareError('Не удалось обновить статус музыки: '+error.message);
      else if(active)setShareError('');
    };
    void write();const timer=window.setInterval(()=>{if(shareNowPlaying && playing)void write()},45000);
    return()=>{active=false;window.clearInterval(timer);};
  },[listenerId,shareLoaded,shareNowPlaying,playing,current?.path,current?.name]);

  const api:MusicApi={ownerId,tracks,current,playing,position,duration,shuffle,repeat,volume,muted,
    shareNowPlaying,shareLoaded,shareError,registerPlaylist,registerClient,select:selectTrack,toggle,
    adjacent,seek,setShuffle,setRepeat,setVolume,setMuted,setMusicPageOpen,setShareNowPlaying};
  const showMini=Boolean(current && !musicPageOpen && shell);
  return <MusicContext.Provider value={api}>
    {children}
    <audio ref={audioRef} preload="metadata" onLoadedMetadata={e=>{
      const audio=e.currentTarget;setDuration(Number.isFinite(audio.duration)?audio.duration:0);
      const restore=restoreRef.current;
      if(restore && restore.path===selectedRef.current){
        try{audio.currentTime=Math.max(0,Math.min(restore.position,Math.max(0,(Number.isFinite(audio.duration)?audio.duration:restore.position+1)-.2)));}catch{/* Some streams are not seekable yet. */}
        restoreRef.current=null;
      }
    }} onTimeUpdate={e=>{
      const n=e.currentTarget.currentTime;setPosition(n);
      if(Date.now()-persistRef.current>2500){persistRef.current=Date.now();savePlayback(n);}
    }} onDurationChange={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)}
      onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>adjacent(1,true)}/>
    {showMini && createPortal(<div className="connect-music-mini" role="region" aria-label="Мини-плеер" style={{bottom:miniBottom}}>
      <button type="button" className="connect-music-mini-drag" aria-label="Переместить мини-плеер вверх или вниз" title="Перетащить мини-плеер"
        onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);miniDrag.current={pointerId:e.pointerId,startY:e.clientY,startBottom:miniBottomRef.current};}}
        onPointerMove={e=>{
          const d=miniDrag.current;if(!d||d.pointerId!==e.pointerId)return;
          const height=shell?.getBoundingClientRect().height||window.innerHeight;
          const ceiling=Math.max(108,height-135);
          const bottom=Math.max(108,Math.min(ceiling,d.startBottom+d.startY-e.clientY));
          miniBottomRef.current=bottom;setMiniBottom(bottom);
        }}
        onPointerUp={e=>{
          if(miniDrag.current?.pointerId!==e.pointerId)return;
          miniDrag.current=null;
          try{localStorage.setItem('connect-music-mini-bottom-v1',String(miniBottomRef.current));}catch{/* ignore */}
        }}
        onPointerCancel={()=>{miniDrag.current=null;}}
        ><span aria-hidden="true">⠿</span></button>
      <button type="button" className="connect-music-mini-title" onClick={()=>window.dispatchEvent(new CustomEvent('connect:music-open',{detail:{ownerId}}))} title="Открыть музыку">
        {icon('music',17)}<span>{current?.name}</span></button>
      <button type="button" aria-label="Предыдущий трек" onClick={()=>adjacent(-1)}>{icon('previous',19)}</button>
      <button type="button" aria-label={playing?'Пауза':'Играть'} onClick={toggle}>{icon(playing?'pause':'play',21)}</button>
      <button type="button" aria-label="Следующий трек" onClick={()=>adjacent(1)}>{icon('next',19)}</button>
      <button type="button" aria-label="Закрыть мини-плеер" onClick={()=>{
        audioRef.current?.pause();ownerRef.current=null;selectedRef.current=null;setOwnerId(null);setSelected(null);setTracks([]);
        try{localStorage.removeItem('connect-profile-music-playback-v1')}catch{/* ignore */}
      }}>{icon('close',15)}</button>
    </div>,shell!)}
  </MusicContext.Provider>;
}

export function ConnectMusicLibrary({client, ownerId, items, isOwner, busy, onRemove}:{
  client:SupabaseClient;ownerId:string;items:ConnectMusicTrack[];isOwner:boolean;busy:boolean;onRemove:(song:ConnectMusicTrack)=>void;
}) {
  const music=useMusic();
  const [more,setMore]=useState<string|null>(null);
  useEffect(()=>{ music.setMusicPageOpen(true); return()=>music.setMusicPageOpen(false); },[music.setMusicPageOpen]);
  useEffect(()=>{music.registerClient(client);},[client,music.registerClient]);
  useEffect(()=>{music.registerPlaylist(ownerId,items);},[ownerId,items,music.registerPlaylist]);
  const active=music.ownerId===ownerId?music.current:null;
  const ratio=music.duration>0 ? `${Math.max(0,Math.min(100,music.position/music.duration*100))}%`:'0%';
  return <>
    {active && <div className="connect-minimal-player" role="region" aria-label="Музыкальный плеер Connect">
      <div className="connect-minimal-player-head">
        <strong className="connect-minimal-player-title" title={active.name}>{active.name}</strong>
        <div className="connect-music-volume">
          <button type="button" aria-label={music.muted?'Включить звук':'Выключить звук'} onClick={()=>music.setMuted(!music.muted)}>{icon(music.muted?'mute':'volume',18)}</button>
          {/* iOS controls physical volume; use only mute/unmute in Connect. */}
        </div>
      </div>
      <div className="connect-minimal-progress">
        <span>{clock(music.position)}</span>
        <input type="range" min={0} max={music.duration>0?music.duration:1} step={.1} value={music.duration>0?Math.min(music.duration,music.position):0}
          disabled={music.duration<=0} onChange={e=>music.seek(Number(e.currentTarget.value))}
          aria-label="Перемотка трека" style={{'--player-progress':ratio} as CSSProperties}/>
        <span>{clock(music.duration)}</span>
      </div>
      <div className="connect-minimal-controls">
        <button type="button" className={'connect-minimal-option'+(music.shuffle?' active':'')} aria-label="Случайный порядок" aria-pressed={music.shuffle} onClick={()=>music.setShuffle(!music.shuffle)}>{icon('shuffle')}</button>
        <button type="button" aria-label="Предыдущий трек" onClick={()=>music.adjacent(-1)}>{icon('previous',24)}</button>
        <button type="button" className="connect-minimal-play" aria-label={music.playing?'Пауза':'Воспроизвести'} onClick={music.toggle}>{icon(music.playing?'pause':'play',26)}</button>
        <button type="button" aria-label="Следующий трек" onClick={()=>music.adjacent(1)}>{icon('next',24)}</button>
        <button type="button" className={'connect-minimal-option'+(music.repeat?' active':'')} aria-label="Повтор списка" aria-pressed={music.repeat} onClick={()=>music.setRepeat(!music.repeat)}>{icon('repeat')}</button>
      </div>
    </div>}
    <div className="connect-minimal-track-list">
      {items.map((song,i)=><div key={song.path} className={'connect-minimal-track'+(active?.path===song.path?' active':'')}>
        <button type="button" className="connect-minimal-track-main" onClick={()=>music.select(song)}>
          <span className="connect-minimal-track-symbol">{icon(active?.path===song.path && music.playing?'music':'play',19)}</span>
          <span className="connect-minimal-track-names"><strong title={song.name}>{song.name}</strong><small>Трек {i+1}</small></span>
        </button>
        {isOwner && <div className="connect-minimal-track-menu-holder"><button type="button" className="connect-minimal-track-more" aria-label="Действия с треком" onClick={()=>setMore(more===song.path?null:song.path)}>{icon('more')}</button>
          {more===song.path && <button type="button" className="connect-minimal-track-delete" disabled={busy} onClick={()=>{setMore(null);onRemove(song);}}>Удалить</button>}</div>}
      </div>)}
    </div>
    {isOwner && <div className="connect-music-privacy">
      <label><input type="checkbox" checked={music.shareNowPlaying} disabled={!music.shareLoaded} onChange={e=>music.setShareNowPlaying(e.currentTarget.checked)}/>
        <span><strong>Показывать «Сейчас слушает»</strong><small>По умолчанию выключено. Видно другим участникам только во время воспроизведения.</small></span></label>
      {music.shareError && <small role="alert">{music.shareError}</small>}
    </div>}
  </>;
}

export function ConnectMusicStatus({client,profileId}:{client:SupabaseClient;profileId:string}) {
  const [song,setSong]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;
    const refresh=async()=>{
      const r=await client.from('connect_music_presence').select('track_name,updated_at,is_playing,is_public').eq('owner_id',profileId).maybeSingle();
      const row=r.data;
      const recent=row?.updated_at && Date.now()-Date.parse(row.updated_at)<150000;
      if(alive)setSong(!r.error && row?.is_public && row.is_playing && recent && row.track_name?String(row.track_name):null);
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),45000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[client,profileId]);
  return song?<div className="connect-profile-now-listening" title={song}>{icon('music',16)} <span>Сейчас слушает: {song}</span></div>:null;
}
