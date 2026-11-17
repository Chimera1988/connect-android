'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

type State='checking'|'active'|'permission'|'disabled'|'unregistered'|'temporary';
type Result={state:Exclude<State,'checking'>;verifiedAt?:string};

const labels:Record<State,string>={
 checking:'Проверяем подписку',active:'Подписка активна',permission:'Уведомления запрещены в Android',
 disabled:'Уведомления отключены',unregistered:'Подписка отсутствует',temporary:'Регистрация не подтверждена',
};
const details:Record<State,string>={
 checking:'Проверяем разрешение Android, токен FCM и регистрацию на сервере Connect.',
 active:'Разрешение получено. Текущий токен устройства зарегистрирован на сервере Connect.',
 permission:'Разрешите уведомления для Connect в настройках Android, затем подключите их повторно.',
 disabled:'Включите уведомления, чтобы восстановить подписку.',
 unregistered:'Токен устройства не найден. Попробуйте подключить уведомления повторно.',
 temporary:'Нет подтверждения сервера. Проверьте интернет и повторите подключение.',
};
export default function ConnectNativePushStatus({userId,prefsEnabled,onEnable}:{userId:string;prefsEnabled:boolean;onEnable:()=>Promise<void>}){
 const [state,setState]=useState<State>('checking');
 const [busy,setBusy]=useState(false);
 const [verifiedAt,setVerifiedAt]=useState<string|null>(null);
 const [testInfo,setTestInfo]=useState('');
 const generation=useRef(0),running=useRef(false);
 const refresh=useCallback(async()=>{
   if(!window.ConnectNative||running.current)return;
   const id=++generation.current;running.current=true;setState('checking');
   try{
     const result=await window.ConnectNative.request('notification:status',{}) as Result;
     if(id!==generation.current)return;
     if(!['active','permission','disabled','unregistered','temporary'].includes(result?.state))throw Error('Недостоверный ответ Android');
     setState(result.state);setVerifiedAt(result.state==='active'&&typeof result.verifiedAt==='string'?result.verifiedAt:null);
   }catch{if(id===generation.current)setState('temporary');}
   finally{running.current=false;}
 },[userId]);
 useEffect(()=>{
   let live=true;
   const onRefresh=()=>{if(live)void refresh();};
   const onVisible=()=>{if(document.visibilityState==='visible')onRefresh();};
   const lifecycle=(event:Event)=>{if((event as CustomEvent).detail==='active')onRefresh();};
   onRefresh();window.addEventListener('focus',onRefresh);window.addEventListener('online',onRefresh);
   window.addEventListener('connect:native-lifecycle',lifecycle);document.addEventListener('visibilitychange',onVisible);
   const interval=window.setInterval(onRefresh,15*60*1000);
   return()=>{live=false;generation.current++;window.clearInterval(interval);window.removeEventListener('focus',onRefresh);
     window.removeEventListener('online',onRefresh);window.removeEventListener('connect:native-lifecycle',lifecycle);
     document.removeEventListener('visibilitychange',onVisible);};
 },[refresh]);
 async function connect(){
   if(busy||!window.ConnectNative)return;
   setBusy(true);setTestInfo('');
   try{
     if(!prefsEnabled)await onEnable();
     const result=await window.ConnectNative.request('notification:connect',{}) as Result;
     if(!['active','permission','disabled','unregistered','temporary'].includes(result?.state))throw Error('Android не подтвердил подписку');
     setState(result.state);setVerifiedAt(result.state==='active'&&typeof result.verifiedAt==='string'?result.verifiedAt:null);
   }catch(e){setState('temporary');setTestInfo(e instanceof Error?e.message:'Не удалось подключить уведомления.');}
   finally{setBusy(false);}
 }
 async function testLocal(){
   if(busy||state!=='active'||!window.ConnectNative)return;
   setBusy(true);setTestInfo('');
   try{const r=await window.ConnectNative.request('notification:test',{}) as {message?:string};
     setTestInfo(r?.message||'Проверка выполнена.');}
   catch(e){setTestInfo(e instanceof Error?e.message:'Не удалось проверить уведомление.');}
   finally{setBusy(false);}
 }
 const time=verifiedAt&&Number.isFinite(Date.parse(verifiedAt))?new Date(verifiedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
 return <div className="connect-native-push-check">
   <div className="connect-web-push-state" role="status" aria-live="polite">
     <span className={'connect-web-push-indicator is-'+(state==='active'?'active':state==='checking'?'checking':state==='temporary'?'temporary':'unregistered')} aria-hidden="true"/>
     <div><strong>{labels[state]}</strong><small>{details[state]}</small>{state==='active'&&time&&<small>Подтверждено сервером: {time}</small>}</div>
   </div>
   <button type="button" className="connect-sound-register" disabled={busy||state==='checking'} onClick={()=>void connect()}>
     {busy?'Подключаем…':state==='active'?'Переподключить уведомления':'Подключить уведомления'}
   </button>
   {state==='active'&&<button type="button" className="connect-web-push-secondary" disabled={busy} onClick={()=>void testLocal()}>Проверить системное уведомление</button>}
   {testInfo&&<p role="status" className="connect-sound-status">{testInfo}</p>}
   <small>Тест проверяет локальный канал уведомлений Android, а не доставку сообщения с сервера FCM.</small>
 </div>;
}
