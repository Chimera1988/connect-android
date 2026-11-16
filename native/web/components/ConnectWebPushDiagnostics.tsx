'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reconcileWebPush} from '../lib/connect-push-repair'; // CONNECT_PWA_PUSH_REPAIR_UI_20261114

type Connection = 'checking'|'active'|'unsupported'|'denied'|'permission'|'missing'|'unregistered'|'disabled'|'invalid-key'|'error'|'temporary';
type Delivery = 'idle'|'sending'|'confirmed'|'unconfirmed'|'error';
type Props={supabase:SupabaseClient;userId:string};
const VAPID=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY||'';
const ACK_EVENT='CONNECT_PUSH_DIAGNOSTIC_RECEIVED';

function vapidBytes(value:string):Uint8Array{
  const pad='='.repeat((4-value.length%4)%4);
  return Uint8Array.from(atob((value+pad).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
/** DOM PushSubscriptionOptions requires a real ArrayBuffer, not ArrayBufferLike. */
function vapidKeyBuffer(value:string):ArrayBuffer{
  const bytes=vapidBytes(value);
  const buffer=new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function validCurrentKey(sub:PushSubscription):boolean{
  if(!VAPID)return false;
  try{
    const expected=vapidBytes(VAPID),current=sub.options.applicationServerKey;
    if(!current)return true; // Some browsers do not expose the key after subscribing.
    const actual=new Uint8Array(current);
    return actual.length===expected.length&&actual.every((n,i)=>n===expected[i]);
  }catch{return false;}
}
async function diagnosticWorkerReady(reg:ServiceWorkerRegistration):Promise<boolean>{
  const worker=reg.active||navigator.serviceWorker.controller;
  if(!worker)return false;
  return new Promise(resolve=>{
    const channel=new MessageChannel();
    const timer=window.setTimeout(()=>{channel.port1.close();resolve(false);},2500);
    channel.port1.onmessage=event=>{
      window.clearTimeout(timer);channel.port1.close();
      resolve(event.data?.type==='CONNECT_DIAGNOSTICS_READY');
    };
    try{worker.postMessage({type:'CONNECT_DIAGNOSTICS_PING'},[channel.port2]);}
    catch{window.clearTimeout(timer);channel.port1.close();resolve(false);}
  });
}
function available():boolean{
  return typeof window!=='undefined'&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window&&Boolean(VAPID);
}
function label(state:Connection):string{
  return ({checking:'Проверяем подписку',active:'Подписка активна',unsupported:'Web Push недоступен',denied:'Уведомления запрещены в iOS',permission:'Требуется разрешение',missing:'Подписка отсутствует',unregistered:'Устройство не зарегистрировано на сервере',disabled:'Уведомления отключены на сервере','invalid-key':'Подписка требует переподключения',error:'Не удалось проверить подписку',temporary:'Временная проблема с сетью'})[state];
}
function description(state:Connection):string{
  return ({checking:'Проверяем разрешение, подписку и регистрацию устройства.',active:'Разрешение получено, текущая подписка есть и зарегистрирована на сервере.',unsupported:'На iPhone открой Connect с экрана «Домой»; проверь настройку Web Push.',denied:'Разреши уведомления для Connect в настройках iPhone.',permission:'Нажми «Подключить уведомления» и предоставь разрешение.',missing:'Нажми «Подключить уведомления», чтобы создать подписку.',unregistered:'Подписка есть на iPhone, но отсутствует в базе Connect. Подключи её повторно.',disabled:'Нажми «Подключить уведомления», чтобы снова включить отправку.', 'invalid-key':'Ключ подписки изменился. Переподключи уведомления.',error:'Не удалось подтвердить регистрацию на сервере. Попробуй ещё раз.',temporary:'Подписка могла сохраниться. Повторная проверка выполнится при восстановлении сети.'})[state];
}
function formatDate(value:string|null):string{
  if(!value)return '';
  const d=new Date(value);
  return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
}

export default function ConnectWebPushDiagnostics({supabase,userId}:Props){
  const [connection,setConnection]=useState<Connection>('checking');
  const [delivery,setDelivery]=useState<Delivery>('idle');
  const [detail,setDetail]=useState('');
  const [busy,setBusy]=useState(false);
  const [lastReceived,setLastReceived]=useState<string|null>(null);
  const pending=useRef<{id:string;timer:number}|null>(null);
  const refreshGeneration=useRef(0);
  const lastTestAt=useRef(0);

  const check=useCallback(async()=>{
    const generation=++refreshGeneration.current;
    const update=(next:Connection)=>{if(generation===refreshGeneration.current)setConnection(next);};
    if(!available()){update('unsupported');return;}
    if(Notification.permission==='denied'){update('denied');return;}
    if(Notification.permission!=='granted'){update('permission');return;}
    if(navigator.onLine===false){update('temporary');return;}
    try{
      const reg=await navigator.serviceWorker.getRegistration();
      const subscription=await reg?.pushManager.getSubscription();
      if(!subscription){update('missing');return;}
      if(!validCurrentKey(subscription)){update('invalid-key');return;}
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){update('error');return;}
      const res=await fetch('/api/push/diagnostics',{
        method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({action:'status',endpoint:subscription.endpoint}),
      });
      if(!res.ok){update(res.status===401?'error':'temporary');return;}
      const result=await res.json() as {registered?:boolean;enabled?:boolean};
      update(!result.registered?'unregistered':result.enabled===false?'disabled':'active');
    }catch{update('temporary');}
  },[supabase,userId]);

  useEffect(()=>{
    try{
      const saved=localStorage.getItem('connect-push-diagnostic-last:'+userId);
      if(saved&&Number.isFinite(Date.parse(saved)))setLastReceived(saved);
    }catch{}
    void check();
    const onFocus=()=>{void check();};
    const onOnline=()=>{void check();};
    const onPushSynced=(event:Event)=>{
      if((event as CustomEvent<{userId:string}>).detail?.userId===userId)void check();
    };
    const onVisible=()=>{if(document.visibilityState==='visible')void check();};
    const onMessage=(event:MessageEvent)=>{
      const data=event.data as {type?:string;requestId?:string;userId?:string;receivedAt?:string}|null;
      const request=pending.current;
      if(!request||!data||data.type!==ACK_EVENT||data.userId!==userId||data.requestId!==request.id)return;
      window.clearTimeout(request.timer);pending.current=null;
      const at=typeof data.receivedAt==='string'&&Number.isFinite(Date.parse(data.receivedAt))?data.receivedAt:new Date().toISOString();
      setLastReceived(at);setDelivery('confirmed');setDetail('Тестовый push обработан на этом iPhone.');
      try{localStorage.setItem('connect-push-diagnostic-last:'+userId,at);}catch{}
    };
    window.addEventListener('focus',onFocus);
    window.addEventListener('online',onOnline);
    window.addEventListener('connect:push-synced',onPushSynced);
    document.addEventListener('visibilitychange',onVisible);
    navigator.serviceWorker?.addEventListener('message',onMessage);
    return()=>{
      refreshGeneration.current++;
      window.removeEventListener('focus',onFocus);
      window.removeEventListener('online',onOnline);
      window.removeEventListener('connect:push-synced',onPushSynced);
      document.removeEventListener('visibilitychange',onVisible);
      navigator.serviceWorker?.removeEventListener('message',onMessage);
      if(pending.current){window.clearTimeout(pending.current.timer);pending.current=null;}
    };
  },[check,userId]);

  async function connect(){
    if(busy||!available())return;
    setBusy(true);setDetail('');
    try{
      // Permission request must originate from this direct button tap on iOS.
      if(Notification.permission==='denied')throw Error('Разреши уведомления в настройках iOS.');
      if(Notification.permission!=='granted'&&await Notification.requestPermission()!=='granted')
        throw Error('Разрешение на уведомления не предоставлено.');
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw Error('Для подключения войди в Connect.');
      const restored=await reconcileWebPush(supabase,userId,{manual:true});
      if(restored.state!=='active')throw Error(({denied:'Уведомления запрещены в iOS.',permission:'Нужно разрешение на уведомления.',unsupported:'Web Push недоступен.',temporary:'Сеть временно недоступна. Попробуй позже.',unauthorized:'Требуется повторный вход в Connect.', 'invalid-key':'Ошибка ключа подписки.', 'needs-action':'iOS не создала подписку. Повтори подключение.'} as Record<string,string>)[restored.state]||'Не удалось восстановить подписку.');
      // The old PWA toggle may have left server-side notifications disabled.
      const {data:stored,error:readError}=await supabase.from('notification_preferences')
        .select('enabled,sound,vibrate').eq('user_id',userId).maybeSingle();
      if(readError)throw Error('Устройство зарегистрировано, но настройки уведомлений не загрузились.');
      if(stored?.enabled!==true){
        const {error:saveError}=await supabase.from('notification_preferences').upsert({
          user_id:userId,enabled:true,sound:stored?.sound||'soft',vibrate:stored?.vibrate??true,updated_at:new Date().toISOString()
        },{onConflict:'user_id'});
        if(saveError)throw Error('Устройство зарегистрировано, но включить отправку не удалось.');
      }
      setDetail('Устройство зарегистрировано. Можно проверить тестовую доставку.');
      setDelivery('idle');
      await check();
    }catch(e){setDetail(e instanceof Error?e.message:'Ошибка подключения.');await check();}
    finally{setBusy(false);}
  }

  async function testDelivery(){
    if(connection!=='active'||pending.current||Date.now()-lastTestAt.current<12000||!available())return;
    lastTestAt.current=Date.now();setDelivery('sending');setDetail('Отправляем тестовое уведомление…');
    const id=crypto.randomUUID();
    try{
      const reg=await navigator.serviceWorker.getRegistration();
      const subscription=await reg?.pushManager.getSubscription();
      if(!reg||!await diagnosticWorkerReady(reg))throw Error('Нужно обновить Service Worker Connect: закрой и снова открой PWA.');
      if(!subscription)throw Error('Подписка исчезла. Подключи уведомления ещё раз.');
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw Error('Сессия Connect истекла.');
      const timer=window.setTimeout(()=>{
        if(pending.current?.id!==id)return;
        pending.current=null;setDelivery('unconfirmed');
        setDetail('Подтверждение не получено за 20 секунд. Это не обязательно означает сбой iOS.');
      },20000);
      pending.current={id,timer};
      const response=await fetch('/api/push/diagnostics',{
        method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({action:'test',endpoint:subscription.endpoint,requestId:id}),
      });
      if(!response.ok){
        const body=await response.json().catch(()=>({}));
        throw Error(typeof body.error==='string'?body.error:'Сервер не смог отправить тестовый push.');
      }
      // HTTP success is only a provider acceptance, NOT a delivery confirmation.
      // The only success path is the matching Service Worker message.
    }catch(e){
      if(pending.current?.id===id){window.clearTimeout(pending.current.timer);pending.current=null;}
      setDelivery('error');setDetail(e instanceof Error?e.message:'Не удалось отправить тест.');
      void check();
    }
  }

  return <section className="connect-notifications connect-web-push" aria-label="Уведомления PWA">
    <div className="connect-web-push-state" role="status" aria-live="polite">
      <span className={'connect-web-push-indicator is-'+connection} aria-hidden="true"/>
      <div><strong>{label(connection)}</strong><small>{description(connection)}</small></div>
    </div>
    <button type="button" className="connect-web-push-primary" disabled={busy||connection==='unsupported'||connection==='checking'} onClick={()=>void connect()}>{busy?'Подключаем…':'Подключить уведомления'}</button>
    <button type="button" className="connect-web-push-secondary" disabled={connection!=='active'||delivery==='sending'} onClick={()=>void testDelivery()}>{delivery==='sending'?'Ожидаем подтверждение…':'Проверить доставку'}</button>
    <div className="connect-web-push-delivery" role="status" aria-live="polite">
      <span className={'connect-web-push-indicator is-'+(delivery==='confirmed'?'active':delivery==='error'||delivery==='unconfirmed'?'unregistered':'checking')} aria-hidden="true"/>
      <div><strong>{delivery==='confirmed'?'Тестовая доставка подтверждена':delivery==='sending'?'Проверяем доставку':delivery==='unconfirmed'?'Нет подтверждения':delivery==='error'?'Ошибка отправки':'Последняя проверка доставки'}</strong>
        <small>{detail|| (lastReceived?'Последний подтверждённый тест: '+formatDate(lastReceived):'Проверка ещё не проводилась')}</small>
        {lastReceived&&detail&&<small>Последний подтверждённый тест: {formatDate(lastReceived)}</small>}
      </div>
    </div>
    <p className="connect-web-push-note">Тест отправляет настоящее системное уведомление. Подтверждение означает, что Service Worker получил push и запросил показ уведомления; оно не гарантирует баннер на экране блокировки.</p>
  </section>;
}
