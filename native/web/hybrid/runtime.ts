import {createClient} from '@supabase/supabase-js';
import type {Session} from '@supabase/supabase-js';
import {saveWallpaper,loadWallpaper} from '../lib/wallpaper';
// Android 10 can retain a WebView predating crypto.randomUUID().
if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}});
type Result={id:string;ok:boolean;result?:unknown;error?:string};
declare global {interface Window {
  ReactNativeWebView?:{postMessage:(data:string)=>void};
  __CONNECT_NONCE__?:string;
  __CONNECT_INITIAL_SESSION__?:{access_token:string;refresh_token:string}|null;
  __connectReceive?:(type:string,data:any)=>void;
  ConnectNative?:{request:(command:string,payload?:unknown)=>Promise<any>};
  __connectNativeCall?:any;
  __connectPrepareSession?:(session:Session|null)=>Promise<void>;
}}
let serial=0;
const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function request(command:string,payload:unknown={}){
  return new Promise<any>((resolve,reject)=>{
    if(!window.ReactNativeWebView||!window.__CONNECT_NONCE__){reject(Error('Нет связи с Android'));return;}
    if(pending.size>=64){reject(Error('Слишком много одновременных действий. Повторите через секунду.'));return;}
    const id=String(++serial);
    const timer=setTimeout(()=>{pending.delete(id);discardFile(id);if(command.startsWith('record'))emit('file:cancel',{id});if(command.startsWith('calls:'))emit('calls:timeout',{requestId:id,command});const labels:Record<string,string>={'calls:dial':'подготовку исходящего звонка','calls:accept':'принятие звонка','calls:end':'завершение звонка','calls:decline':'отклонение звонка','calls:route':'выбор аудиоустройства'};reject(Error(command.startsWith('calls:')?'Android не подтвердил '+(labels[command]||'управление звонком')+'. Проверьте экран вызова и сохраните диагностику.':'Android не завершил действие «'+command+'». Повторите после возвращения в приложение.'));},['recordVideo:open','recordVoice:start','sounds:pick','files:begin'].includes(command)?600000:60000);
    pending.set(id,{resolve,reject,timer});
    try{post(id,command,payload);}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
}
function post(id:string,command:string,payload:unknown){window.ReactNativeWebView!.postMessage(JSON.stringify({v:1,nonce:window.__CONNECT_NONCE__,id,command,payload}));}
function emit(command:string,payload:unknown){try{post('event:'+String(++serial),command,payload);}catch{}}
function action(command:string,payload:unknown={}){void request(command,payload).catch(e=>window.dispatchEvent(new CustomEvent('connect:native-error',{detail:e.message})));}
window.ConnectNative={request};
const transfers=new Map<string,{parts:Uint8Array[];name:string;type:string;size:number;received:number}>();
const files=new Map<string,File>();
function discardFile(id:string){transfers.delete(id);files.delete(id);}
function rejectTransfer(id:string,message:string){
  discardFile(id);emit('file:cancel',{id});
  const waiting=pending.get(id);if(!waiting)return;
  pending.delete(id);clearTimeout(waiting.timer);waiting.reject(Error(message));
}
let fullScreenAllowed=true;
let sounds={message:'Мягкий',call:'По умолчанию',messageCustom:false,callCustom:false,messageSilent:false,callSilent:false};
window.__connectReceive=(type,data)=>{
  if(type==='record-level'){window.dispatchEvent(new CustomEvent('connect:record-level',{detail:data}));return;}
  if(type==='response'){
    const r=data as Result,p=pending.get(r.id);if(!p){discardFile(r.id);return;}pending.delete(r.id);clearTimeout(p.timer);
    if(r.ok){const value=r.result as {fileId?:string}|null;if(value?.fileId){const file=value.fileId===r.id?files.get(r.id):undefined;if(file)p.resolve((value as any).preferences?{preferences:(value as any).preferences,file}:file);else p.reject(Error('Android не передал запись полностью. Повторите отправку.'));}else p.resolve(r.result);}else p.reject(Error(r.error||'Ошибка Android'));
    discardFile(r.id);return;
  }
  if(type==='file:start'){
    if(!pending.has(data.id)||transfers.size>=1||!Number.isInteger(data.size)||data.size<=0||data.size>32*1024*1024||
      typeof data.name!=='string'||data.name.length>256||!['audio/mp4','video/mp4','image/jpeg','image/png','image/gif','image/webp'].includes(data.type)){rejectTransfer(data.id,'Некорректная передача записи.');return;}
    transfers.set(data.id,{name:data.name,type:data.type,size:data.size,parts:[],received:0});emit('file:ack',{id:data.id,offset:0});return;
  }
  if(type==='file:chunk'){
    const transfer=transfers.get(data.id);
    if(!transfer||!pending.has(data.id)){emit('file:cancel',{id:data.id});return;}
    try{
      if(typeof data.base64!=='string'||data.base64.length>44000)throw Error('Некорректная часть записи.');
      const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));
      if(!bytes.length||bytes.length>32768||data.offset!==transfer.received+bytes.length||data.offset>transfer.size)throw Error('Нарушен порядок передачи записи.');
      transfer.received=data.offset;transfer.parts.push(bytes);emit('file:ack',{id:data.id,offset:transfer.received});
    }catch(error){rejectTransfer(data.id,error instanceof Error?error.message:'Ошибка передачи записи.');}return;
  }
  if(type==='file:end'){
    const transfer=transfers.get(data.id);transfers.delete(data.id);
    if(transfer&&pending.has(data.id)&&transfer.received===transfer.size)files.set(data.id,new File(transfer.parts as BlobPart[],transfer.name,{type:transfer.type}));
    else rejectTransfer(data.id,'Запись передана не полностью.');return;
  }
  if(type==='record-state'){window.dispatchEvent(new CustomEvent('connect:native-recording',{detail:data}));return;}
  if(type==='push-status'){window.dispatchEvent(new CustomEvent('connect:android-push-status',{detail:data}));}
  if(type==='sounds'){fullScreenAllowed=data.fullScreenAllowed!==false;sounds=data;window.dispatchEvent(new Event('connect:android-sound-selected'));}
  if(type==='call'){if(data.phase!=='idle')document.querySelectorAll<HTMLMediaElement>('audio,video').forEach(media=>media.pause());window.__connectNativeCall=data;window.dispatchEvent(new CustomEvent('connect:native-call',{detail:data}));}
  if(type==='native-session'){receiveNativeSession(data);}
  if(type==='error')window.dispatchEvent(new CustomEvent('connect:native-error',{detail:typeof data==='string'?data:'Ошибка Android'}));
  if(type==='chat'){window.__connectAndroidPendingChat=data;window.dispatchEvent(new Event('connect:android-open-chat'));}
  if(type==='lifecycle'){
    // Chromium's document visibility can lag React Native's lifecycle.
    if(data!=='active')document.querySelectorAll<HTMLMediaElement>('audio[data-connect-voice],video').forEach(m=>m.pause());
    if(data==='background')for(const id of transfers.keys())rejectTransfer(id,'Передача записи отменена при сворачивании.');
    window.dispatchEvent(new CustomEvent('connect:native-lifecycle',{detail:data}));
  }
};
window.ConnectAndroid={
  register:token=>action('register',{token}),
  setPreferences:json=>{try{action('preferences',JSON.parse(json));}catch{}},
  pickSound:kind=>action('sounds:pick',{kind}),resetSound:kind=>action('sounds:reset',{kind}),
  previewSound:kind=>action('sounds:preview',{kind}),previewBuiltInSound:tone=>action('sounds:previewBuiltin',{tone}),
  stopPreviewSound:()=>action('sounds:stop'),setSilent:(kind,muted)=>action('sounds:silent',{kind,muted}),
  getSoundSettings:()=>JSON.stringify(sounds),
  canShowFullScreenCalls:()=>fullScreenAllowed,
  dismissConversationNotifications:(id,readAt)=>{if(readAt)action('read',{conversationId:id,readAt});},
  setActiveConversation:id=>action('activeConversation',{id}),
  setSpeakerphone:enabled=>action('calls:speaker',{enabled}),
  setCallState:()=>{}, // Native WebRTC/Telecom exclusively owns call lifecycle.
  openCallNotificationSettings:()=>action('notification:settings'),
};
// The native bridge, never Web Push/service workers, owns Android notifications.
if('serviceWorker' in navigator)void navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>void r.unregister())).catch(()=>{});
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
  auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:(input,init)=>{
    const raw=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    const prefix=process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const target=raw.startsWith(prefix+'/')?'/supabase'+raw.slice(prefix.length):raw;
    return fetch(input instanceof Request?new Request(new URL(target,location.origin),input):target,init);
  }},
});
type NativeSession={access_token:string;refresh_token:string}|null;
let authBootstrapped=false,lastPublishedToken:string|null|undefined,applyingNative=false;
let deferredNativeSession:NativeSession|undefined;
let nativeSessionQueue=Promise.resolve();
function publishSession(session:Session|null){
  const token=session?.access_token||null;
  if(applyingNative||token===lastPublishedToken)return;
  lastPublishedToken=token;action('session',session?{access_token:session.access_token,refresh_token:session.refresh_token}:null);
}
function receiveNativeSession(session:NativeSession){
  deferredNativeSession=session;
  if(!authBootstrapped)return;
  const change=deferredNativeSession;deferredNativeSession=undefined;
  nativeSessionQueue=nativeSessionQueue.catch(()=>{}).then(async()=>{
    const {data:{session:current}}=await client.auth.getSession();
    if(change?.access_token===current?.access_token||(!change&&!current))return;
    applyingNative=true;
    try{
      if(change){const {error}=await client.auth.setSession(change);if(error)throw error;lastPublishedToken=change.access_token;}
      else{const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;lastPublishedToken=null;}
    }finally{applyingNative=false;}
  }).catch(error=>{window.dispatchEvent(new CustomEvent('connect:native-error',{detail:error instanceof Error?error.message:'Не удалось обновить сессию.'}));});
}
const migrations=new Map<string,Promise<void>>();
async function prepareSession(session:Session|null){
  if(!session){publishSession(null);return;}
  await request('session',{access_token:session.access_token,refresh_token:session.refresh_token});
  lastPublishedToken=session.access_token;
  const key='connect-android-hybrid-migration-v1.'+session.user.id;
  if(localStorage.getItem(key)==='done')return;
  let migration=migrations.get(key);
  if(!migration){migration=(async()=>{
    const data=await request('migration:get');
    for(const [name,value] of Object.entries(data.preferences||{}) as Array<[string,string]>){
      if(name.startsWith('connect-hidden-messages:')){const old=JSON.parse(localStorage.getItem(name)||'[]');localStorage.setItem(name,JSON.stringify([...new Set([...old,...JSON.parse(value)])]));}
      else if(localStorage.getItem(name)===null)localStorage.setItem(name,value);
    }
    if(data.file&&!await loadWallpaper())await saveWallpaper(data.file);
    localStorage.setItem(key,'done');
  })().finally(()=>migrations.delete(key));migrations.set(key,migration);}
  await migration;
}
window.__connectPrepareSession=prepareSession;
// Restore existing native logins before the PWA auth screen first renders.
export const ready=(async()=>{
  // A verified request proves the receiver exists before native events flush.
  await request('bridge:ready');
  const {data}=await client.auth.getSession();
  if(!data.session&&window.__CONNECT_INITIAL_SESSION__)await client.auth.setSession(window.__CONNECT_INITIAL_SESSION__);
  const current=await client.auth.getSession();await prepareSession(current.data.session);
  client.auth.onAuthStateChange((_event,session)=>{publishSession(session);});
  authBootstrapped=true;if(deferredNativeSession!==undefined)receiveNativeSession(deferredNativeSession);
  action('sounds:get');
})();
window.addEventListener('pagehide',()=>{
  for(const [id,operation] of pending){clearTimeout(operation.timer);operation.reject(Error('Интерфейс перезапущен.'));discardFile(id);}
  pending.clear();transfers.clear();files.clear();
});

let saving=false;
async function saveDownload(href:string,name:string){
  if(saving)throw Error('Завершите предыдущее сохранение');
  saving=true;let id:string|null=null;
  try{
    const response=await fetch(href);if(!response.ok)throw Error('Не удалось загрузить файл');
    const blob=await response.blob();if(blob.size>100*1024*1024)throw Error('Максимальный размер файла — 100 МБ');
    const mime=blob.type.split(';')[0]||'application/octet-stream';
    id=await request('files:begin',{name:(name||'Connect').replace(/[\\/\x00-\x1f]/g,'_').slice(0,240),mimeType:mime});if(!id)return;
    for(let offset=0;offset<blob.size;offset+=32768){const bytes=new Uint8Array(await blob.slice(offset,offset+32768).arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);await request('files:chunk',{id,data:btoa(binary)});}
    await request('files:end',{id});id=null;
  }finally{if(id)await request('files:cancel',{id}).catch(()=>{});saving=false;}
}
const originalClick=HTMLAnchorElement.prototype.click;
function download(anchor:HTMLAnchorElement){if(!anchor.download&&!anchor.href.startsWith('blob:'))return false;const url=new URL(anchor.href,location.href);if(!['https:','blob:','data:'].includes(url.protocol))return false;void saveDownload(url.href,anchor.download).catch(error=>window.dispatchEvent(new CustomEvent('connect:native-error',{detail:error.message})));return true;}
HTMLAnchorElement.prototype.click=function(){if(!download(this))originalClick.call(this);};
document.addEventListener('click',event=>{const a=(event.target as Element)?.closest?.('a');if(a instanceof HTMLAnchorElement&&download(a)){event.preventDefault();event.stopPropagation();}},true);
