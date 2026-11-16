/** CONNECT_PWA_PUSH_REPAIR_20261114
 * Reconcile a browser-owned PushSubscription with this signed-in user's server
 * registration. Never request notification permission except on an explicit UI tap.
 * Never delete other installations' endpoints, or treat a network error as revocation.
 */
import type {SupabaseClient} from '@supabase/supabase-js';

export type PushRepairState = 'active'|'unsupported'|'permission'|'denied'|'invalid-key'|'needs-action'|'disabled'|'temporary'|'unauthorized';
export type PushRepairResult = {state:PushRepairState;reason?:string};
const VAPID=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY||'';
let queue:Promise<void>=Promise.resolve();

function vapidKey():ArrayBuffer{
  const b64=VAPID.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=Uint8Array.from(atob(b64+'='.repeat((4-b64.length%4)%4)),char=>char.charCodeAt(0));
  const output=new ArrayBuffer(bytes.length);
  new Uint8Array(output).set(bytes);
  return output;
}
function sameKey(sub:PushSubscription):boolean{
  try{
    const saved=sub.options?.applicationServerKey;
    if(!saved)return true; // Browsers may not expose the existing VAPID key.
    const a=new Uint8Array(saved),b=new Uint8Array(vapidKey());
    return a.length===b.length&&a.every((x,i)=>x===b[i]);
  }catch{return false;}
}
function isAvailable():boolean{
  return typeof window!=='undefined' && !window.ConnectAndroid && !!VAPID &&
    'serviceWorker'in navigator && 'PushManager'in window && 'Notification'in window;
}
function lastEndpointKey(userId:string):string{return 'connect-web-push-last-endpoint:'+userId;}
async function endpointAfterSuccess(userId:string,endpoint:string,token:string):Promise<void>{
  // Same-origin, same-account only: never remove all devices or all user rows.
  try{
    const key=lastEndpointKey(userId),previous=localStorage.getItem(key);
    localStorage.setItem(key,endpoint);
    if(previous && previous!==endpoint){
      // Failure to retire an old record must NOT undo a working new subscription.
      await fetch('/api/push/register',{method:'DELETE',cache:'no-store',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({endpoint:previous})}).catch(()=>{});
    }
  }catch{/* Storage can be disabled in private browsing. */}
}
async function reconcile(client:SupabaseClient,userId:string,manual:boolean):Promise<PushRepairResult>{
  if(!isAvailable())return {state:'unsupported'};
  if(Notification.permission==='denied')return {state:'denied'};
  if(Notification.permission!=='granted')return {state:'permission'};
  if(navigator.onLine===false)return {state:'temporary'};
  let reg:ServiceWorkerRegistration|undefined;
  let sub:PushSubscription|null=null;
  try{
    reg=await navigator.serviceWorker.getRegistration();
    if(!reg)reg=await navigator.serviceWorker.register('/sw.js');
    sub=await reg.pushManager.getSubscription();
  }catch{return {state:'temporary',reason:'service-worker'};}
  if(sub&&!sameKey(sub)){
    if(!manual)return {state:'invalid-key'};
    try{if(!await sub.unsubscribe())return {state:'needs-action'};sub=null;}
    catch{return {state:'needs-action'};}
  }
  let token:string;
  try{
    const {data:{session},error}=await client.auth.getSession();
    if(error||!session?.access_token)return {state:'unauthorized'};
    token=session.access_token;
  }catch{return {state:'temporary'};}
  if(!manual){
    try{
      // Verify preferences even when the device lost its local subscription.
      // Never resurrect explicitly disabled notifications.
      if(!sub){
        const {data,error}=await client.from('notification_preferences').select('enabled').eq('user_id',userId).maybeSingle();
        if(error)return {state:'temporary'};
        if(data?.enabled===false)return {state:'disabled'};
      }else{
        const response=await fetch('/api/push/diagnostics',{method:'POST',cache:'no-store',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body:JSON.stringify({action:'status',endpoint:sub.endpoint})});
        if(response.status===401)return {state:'unauthorized'};
        if(!response.ok)return {state:'temporary',reason:'server-status'};
        const status=await response.json() as {registered?:boolean;enabled?:boolean};
        if(status.enabled===false)return {state:'disabled'};
        if(status.registered){await endpointAfterSuccess(userId,sub.endpoint,token);return {state:'active'};}
      }
    }catch{return {state:'temporary',reason:'network'};}
  }
  if(!sub){
    try{
      sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidKey()});
    }catch{return {state:'needs-action',reason:'subscription'};}
  }
  try{
    const response=await fetch('/api/push/register',{method:'POST',cache:'no-store',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({platform:'web',endpoint:sub.endpoint,subscription:sub.toJSON()})});
    if(response.status===401)return {state:'unauthorized'};
    if(!response.ok)return {state:'temporary',reason:'server-register'};
    await endpointAfterSuccess(userId,sub.endpoint,token);
    if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('connect:push-synced',{detail:{userId}}));
    return {state:'active'};
  }catch{return {state:'temporary',reason:'network'};}
}
export function reconcileWebPush(client:SupabaseClient,userId:string,{manual=false}:{manual?:boolean}={}):Promise<PushRepairResult>{
  // Serialize concurrent app-start and settings-screen requests to avoid duplicate subscribe().
  const task=queue.then(()=>reconcile(client,userId,manual));
  queue=task.then(()=>{},()=>{});
  return task;
}
