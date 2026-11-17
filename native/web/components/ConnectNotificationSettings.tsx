'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import ConnectWebPushDiagnostics from './ConnectWebPushDiagnostics';
import ConnectNativePushStatus from './ConnectNativePushStatus';

import {isNotificationTone,serverNotificationPrefs,mergeServerNotificationPrefs,type NotificationTone as Sound} from '../lib/android-sound-policy';
type Prefs = { enabled: boolean; sound: Sound; vibrate: boolean };
type NativeSounds = { message: string; call: string; messageCustom: boolean; callCustom: boolean; messageSilent: boolean; callSilent: boolean };
const defaults: Prefs = { enabled: true, sound: 'soft', vibrate: true };
declare global {
  interface Window {
    ConnectAndroid?: {
      register: (token: string) => void;
      setPreferences: (json: string) => void;
      pickSound: (kind: string) => void;
      resetSound: (kind: string) => void;
      previewSound: (kind: string) => void;
      previewBuiltInSound?: (sound: Sound) => void;
      stopPreviewSound: () => void;
      canShowFullScreenCalls: () => boolean;
      setSilent: (kind: string, muted: boolean) => void;
      setSpeakerphone: (enabled: boolean) => void;
      getSoundSettings: () => string;
      dismissConversationNotifications: (id: string, readAt?:string) => void;
      setActiveConversation: (id: string) => void;
      setCallState: (id: string, state: string) => void;
      openCallNotificationSettings: () => void;
    };
    __connectAndroidPendingCall?: { action: 'open' | 'accept' | 'decline'; callId: string };
    __connectAndroidPendingChat?: string;
  }
}
function vapidBytes(value:string) {
  const pad='='.repeat((4-value.length%4)%4);
  return Uint8Array.from(atob((value+pad).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
function valid(p:any):p is Prefs {
  return p && typeof p.enabled==='boolean' && typeof p.vibrate==='boolean'
    && isNotificationTone(p.sound);
}
function nativeSounds(): NativeSounds | null {
  try {return window.ConnectAndroid ? JSON.parse(window.ConnectAndroid.getSoundSettings()) as NativeSounds : null;} catch {return null;}
}

/* CONNECT_PWA_PUSH_DIAGNOSTICS_V1: runtime choice after hydration; Android stays unchanged. */
export default function ConnectNotificationSettings(props:{supabase:SupabaseClient;userId:string}){
  const [runtime,setRuntime]=useState<'pending'|'web'|'android'>('pending');
  useEffect(()=>{setRuntime(window.ConnectAndroid?'android':'web');},[]);
  if(runtime==='pending')return <section className="connect-notifications" aria-label="Уведомления"/>;
  return runtime==='web'?<ConnectWebPushDiagnostics {...props}/>:<ConnectAndroidNotificationSettings {...props}/>;
}
// CONNECT_ANDROID_NOTIFICATION_COMPACT_20261116
function SoundActionIcon({name}:{name:'choose'|'play'|'stop'|'reset'}){
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name==='choose'?<><path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 10h18l-2 9H5l-2-9Z"/></>:
     name==='play'?<path d="M8 5.5v13l11-6.5-11-6.5Z"/>:
     name==='stop'?<rect x="6" y="6" width="12" height="12" rx="2"/>:
     <><path d="M20 6v5h-5"/><path d="M20 11a8 8 0 1 0 .2 4"/></>}
  </svg>;
}
function ConnectAndroidNotificationSettings({supabase,userId}:{supabase:SupabaseClient,userId:string}) {
  const [diagnostics,setDiagnostics]=useState('');
  const [prefs,setPrefs]=useState<Prefs>(defaults), [status,setStatus]=useState(''), [busy,setBusy]=useState(false);
  const [sounds,setSounds]=useState<NativeSounds|null>(null);
  const [fullScreenAllowed,setFullScreenAllowed]=useState(true);
  const latest=useRef(defaults),revision=useRef(0),queue=useRef<Promise<void>>(Promise.resolve());
  const storageKey='connect-notification-prefs-'+userId;
  function apply(p: Prefs) {
    // Existing users may have stored bright/gentle/legacy or silent presets.
    // The Android picker now uses only the Connect default or custom files.
    if(p.sound==='silent')window.ConnectAndroid?.setSilent('message',true);
    const normalized:Prefs={...p,sound:'soft'};
    latest.current=normalized;setPrefs(normalized);
    try {localStorage.setItem(storageKey,JSON.stringify(normalized));} catch {}
    window.ConnectAndroid?.setPreferences(JSON.stringify(normalized));
  }
  useEffect(()=>{
    function changed(){
      setSounds(nativeSounds());
      try { setFullScreenAllowed(window.ConnectAndroid?.canShowFullScreenCalls?.() ?? true); }
      catch { setFullScreenAllowed(true); }
    }
    changed();
    function pushStatus(event:Event){
      const detail=(event as CustomEvent<{ok:boolean}>).detail;
      setStatus(detail?.ok?'Android: уведомления подключены':'Android: ошибка регистрации уведомлений');
    }
    window.addEventListener('connect:android-sound-selected',changed);
    window.addEventListener('focus',changed);
    window.addEventListener('connect:android-push-status',pushStatus);
    return ()=>{
      window.removeEventListener('connect:android-sound-selected',changed);
      window.removeEventListener('focus',changed);
      window.removeEventListener('connect:android-push-status',pushStatus);
      window.ConnectAndroid?.stopPreviewSound();
    };
  },[]);
  useEffect(()=>{
    let live=true;revision.current=0;queue.current=Promise.resolve();
    let local:Prefs|undefined;
    try {const raw=localStorage.getItem(storageKey);const parsed=raw?JSON.parse(raw):null;if(valid(parsed))local=parsed;} catch {}
    if(local)apply(local);else apply(defaults);
    const startedAt=revision.current;
    void supabase.from('notification_preferences').select('enabled,sound,vibrate').eq('user_id',userId).maybeSingle().then(({data,error})=>{
      if(!live||revision.current!==startedAt)return;
      if(error){setStatus('Не удалось загрузить настройки с сервера');return;}
      if(valid(data))apply(mergeServerNotificationPrefs(data,latest.current));else if(local){void persist(local);}
    });
    return()=>{live=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[supabase,userId]);
  async function persist(next:Prefs) {
    const {error}=await supabase.from('notification_preferences')
      .upsert({user_id:userId,...serverNotificationPrefs(next),updated_at:new Date().toISOString()},{onConflict:'user_id'});
    if(error)throw error;
  }
  function save(next:Prefs) {
    window.ConnectAndroid?.stopPreviewSound();
    revision.current++;const version=revision.current;apply(next);setStatus('Сохраняем…');
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      try {await persist(next);if(revision.current===version)setStatus('Настройки сохранены');}
      catch(e){if(revision.current===version)setStatus('Не удалось сохранить на сервере. Повторите изменение.');console.error('Connect notification preferences:',e);}
    });
  }
  async function activate() {
    if(busy)return;
    setBusy(true);
    try {
      if (!window.ConnectAndroid) {
        if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))
          throw Error('Web Push недоступен. На iPhone откройте Connect с экрана «Домой».');
        if(!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)throw Error('VAPID ещё не настроен');
        if(Notification.permission!=='granted' && await Notification.requestPermission()!=='granted')
          throw Error('Разрешение на уведомления не предоставлено');
      }
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw Error('Войдите в аккаунт');
      if(window.ConnectAndroid) {
        window.ConnectAndroid.setPreferences(JSON.stringify(latest.current));
        window.ConnectAndroid.register(session.access_token);
        setStatus('Android: ожидаем подтверждения регистрации');return;
      }
      const key=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const reg=await navigator.serviceWorker.register('/sw.js');
      let sub=await reg.pushManager.getSubscription();
      const bytes=vapidBytes(key),oldKey=sub?.options.applicationServerKey;
      const matches=oldKey&&new Uint8Array(oldKey).length===bytes.length&&new Uint8Array(oldKey).every((v,i)=>v===bytes[i]);
      if(sub&&!matches){await sub.unsubscribe();sub=null;}
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      const response=await fetch('/api/push/register',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({platform:'web',endpoint:sub.endpoint,subscription:sub.toJSON()}),
      });
      if(!response.ok){const detail=await response.json().catch(()=>({}));throw Error(detail.error||'Не удалось зарегистрировать устройство');}
      setStatus('Уведомления подключены.');
    } catch(e){setStatus(e instanceof Error?e.message:'Ошибка подключения');}
    finally{setBusy(false);}
  }
  return <section className="connect-notifications connect-android-notification-settings" aria-label="Звуки и уведомления">
    <div className="connect-sound-options">
      <label className="connect-sound-toggle connect-sound-switch-row"><span>Уведомления включены</span><input type="checkbox" role="switch" checked={prefs.enabled} onChange={e=>save({...latest.current,enabled:e.target.checked})}/><span className="connect-sound-switch-track" aria-hidden="true"/></label>
      <label className="connect-sound-toggle connect-sound-switch-row"><span>Вибрация сообщений</span><input type="checkbox" role="switch" checked={prefs.vibrate} onChange={e=>save({...latest.current,vibrate:e.target.checked})}/><span className="connect-sound-switch-track" aria-hidden="true"/></label>
    </div>
    <div className="connect-android-sounds">
      <h3>Мелодии Connect</h3>
      <p className="connect-sound-hint">По умолчанию используются звуки Connect. При желании можно выбрать свою мелодию из файлов телефона.</p>
      {sounds && <div className="connect-sound-card connect-sound-combined">
        {(['call','message'] as const).map(kind=>{
        const isCall=kind==='call',silent=isCall?sounds.callSilent:sounds.messageSilent;
        const custom=isCall?sounds.callCustom:sounds.messageCustom;
        const title=isCall?'Входящий аудиозвонок':'Сообщение';
        const current=isCall?sounds.call:sounds.message;
        const defaultName=isCall?'Connect — звонок':'Connect — сообщение';
        return <div key={kind} className="connect-sound-entry">
          <div className="connect-sound-topline">
            <div className="connect-sound-heading"><strong>{title}</strong><small>{custom?current:defaultName}</small></div>
            <label className="connect-sound-mute connect-sound-switch-row">
              <span>Без звука</span>
              <input type="checkbox" role="switch" checked={silent} onChange={e=>{
                const checked=e.currentTarget.checked;
                setSounds(prev=>prev?{...prev,[isCall?'callSilent':'messageSilent']:checked}:prev);
                window.ConnectAndroid?.setSilent(kind,checked);
              }}/>
              <span className="connect-sound-switch-track" aria-hidden="true"/>
            </label>
          </div>
          <div className="connect-sound-icon-row" role="group" aria-label={'Управление: '+title}>
            <button type="button" className="connect-sound-icon-button" title="Выбрать свою мелодию" aria-label={`Выбрать ${isCall?'мелодию звонка':'звук сообщения'}`} onClick={()=>window.ConnectAndroid?.pickSound(kind)}><SoundActionIcon name="choose"/></button>
            <button type="button" className="connect-sound-icon-button" title="Прослушать" aria-label={`Прослушать ${title.toLowerCase()}`} disabled={silent} onClick={()=>window.ConnectAndroid?.previewSound(kind)}><SoundActionIcon name="play"/></button>
            <button type="button" className="connect-sound-icon-button" title="Остановить" aria-label={`Остановить ${title.toLowerCase()}`} onClick={()=>window.ConnectAndroid?.stopPreviewSound()}><SoundActionIcon name="stop"/></button>
            <button type="button" className="connect-sound-icon-button" title="Вернуть звук Connect" aria-label={`Сбросить ${title.toLowerCase()} на звук Connect`} onClick={()=>{if(!isCall)save({...latest.current,sound:'soft'});window.ConnectAndroid?.resetSound(kind);}}><SoundActionIcon name="reset"/></button>
          </div>
        </div>;
        })}
      </div>}
    </div>
    {window.ConnectNative?<ConnectNativePushStatus userId={userId} prefsEnabled={prefs.enabled} onEnable={async()=>{
      if(latest.current.enabled)return;
      const next={...latest.current,enabled:true};
      await persist(next);
      await window.ConnectNative!.request('preferences',next);
      revision.current++;apply(next);
    }}/>:<button type="button" className="connect-sound-register" disabled={busy} onClick={()=>void activate()}>{busy?'Подключаем…':'Подключить уведомления'}</button>}
    <p role="status" className="connect-sound-status">{status}</p>
    <details className="connect-android-advanced"><summary>Системные настройки и диагностика</summary>
      {!fullScreenAllowed && <p role="alert">Android запрещает полноэкранный показ звонков. Проверьте системные разрешения.</p>}
      <button type="button" onClick={()=>window.ConnectAndroid?.openCallNotificationSettings()}>{fullScreenAllowed?'Проверить полноэкранные звонки':'Разрешить полноэкранные звонки'}</button>
      {window.ConnectNative && <>
        <button type="button" onClick={()=>{void window.ConnectNative!.request('notification:diagnostics').then(events=>setDiagnostics(JSON.stringify(events,null,2))).catch(error=>setStatus(error instanceof Error?error.message:'Не удалось прочитать журнал'));}}>Журнал уведомлений</button>
        {diagnostics&&<pre className="connect-sound-diagnostics">{diagnostics}</pre>}
      </>}
      <small>Android может ограничивать звук и вибрацию системными настройками. Приложение не обходит запреты устройства.</small>
      <small>Проверка системного уведомления проверяет только локальный канал Android, но не доставку сообщений с сервера FCM.</small>
    </details>
  </section>;
}
