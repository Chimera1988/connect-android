/** Connect Android native FCM transport. No WebView or Supabase service-role secrets. */
import {getMessaging,getToken,onMessage,onTokenRefresh,setBackgroundMessageHandler} from '@react-native-firebase/messaging';
import notifee, {AndroidCategory, AndroidImportance, AndroidVisibility, EventType} from '@notifee/react-native';
import * as SecureStore from 'expo-secure-store';
import {db} from './backend';

const API=(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'');
const DEVICE_ACTIVE_KEY='connect-native-fcm-authorized-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES='connect-native-messages-v1';
const CALLS='connect-native-calls-v1';

type Data=Record<string,string|undefined>;
export type NativePushDestination={kind:'chat';conversationId:string}|{kind:'call';callId:string;conversationId:string|null};
let onOpen:((destination:NativePushDestination)=>void)|null=null;
let bufferedOpen:NativePushDestination|null=null;
let visibleConversation:string|null=null;
export function setVisibleConversation(id:string|null){visibleConversation=id;}
function route(raw:Record<string,unknown>|undefined):NativePushDestination|null {
  if(!raw)return null;
  const conversationId=raw.conversationId;
  const callId=raw.callId;
  if(raw.kind==='incoming-call' && typeof callId==='string' && UUID.test(callId))
    return {kind:'call',callId,conversationId:typeof conversationId==='string'&&UUID.test(conversationId)?conversationId:null};
  if((raw.kind==='message'||raw.kind==='chat') && typeof conversationId==='string'&&UUID.test(conversationId))
    return {kind:'chat',conversationId};
  return null;
}
function deliverOpen(raw:Record<string,unknown>|undefined){
  const dest=route(raw);if(!dest)return;
  if(onOpen)onOpen(dest);else bufferedOpen=dest;
}

async function ensureChannels(){
  await Promise.all([
    notifee.createChannel({id:MESSAGES,name:'Connect · Сообщения',importance:AndroidImportance.HIGH,sound:'default',vibration:true}),
    notifee.createChannel({id:CALLS,name:'Connect · Аудиозвонки',importance:AndroidImportance.HIGH,sound:'default',vibration:true}),
  ]);
}
/** Handles the data-only FCM payloads already sent by the Connect server. */
export async function handleNativePush(data:Data|undefined){
  if(!data)return;
  if(data.kind==='read'){
    if(data.conversationId&&UUID.test(data.conversationId))await notifee.cancelNotification('chat:'+data.conversationId);
    return;
  }
  if(data.kind==='call-ended'){
    if(data.callId&&UUID.test(data.callId))await notifee.cancelNotification('call:'+data.callId);
    return;
  }
  if(await SecureStore.getItemAsync(DEVICE_ACTIVE_KEY)!=='yes')return;
  if(data.kind==='incoming-call'&&data.callId&&UUID.test(data.callId)){
    await ensureChannels();
    await notifee.displayNotification({
      id:'call:'+data.callId,
      title:'Входящий аудиозвонок · Connect',
      body:'Открыть Connect для просмотра вызова',
      data:{kind:'incoming-call',callId:data.callId,conversationId:data.conversationId||''},
      android:{channelId:CALLS,category:AndroidCategory.CALL,importance:AndroidImportance.HIGH,
        visibility:AndroidVisibility.PRIVATE,pressAction:{id:'default'},autoCancel:true,timeoutAfter:65000},
    });
    return;
  }
  if((data.kind==='message'||data.kind==='chat'||(!data.kind && data.messageId))&&data.conversationId&&UUID.test(data.conversationId)){
    if(data.conversationId===visibleConversation)return;
    await ensureChannels();
    await notifee.displayNotification({
      id:'chat:'+data.conversationId,
      title:'Connect · Новое сообщение',body:'Откройте переписку, чтобы прочитать сообщение',
      data:{kind:'message',conversationId:data.conversationId},
      android:{channelId:MESSAGES,category:AndroidCategory.MESSAGE,importance:AndroidImportance.HIGH,
        visibility:AndroidVisibility.PRIVATE,pressAction:{id:'default'},autoCancel:true},
    });
  }
}

/** Must run at JavaScript entry-point, including when Android starts a headless task. */
export function installNativePushBackgroundHandlers(){
  setBackgroundMessageHandler(getMessaging(), async message=>{await handleNativePush(normalizeFcmData(message.data)||undefined);});
  notifee.onBackgroundEvent(async ({type})=>{
    // Android launches the app on press. The initial notification is read after boot.
    if(type===EventType.PRESS||type===EventType.ACTION_PRESS)return;
  });
}
async function sendRegistration(endpoint:string, method:'POST'|'DELETE',expectedUser:string){
  const {data:{session}}=await db.auth.getSession();
  if(!session||session.user.id!==expectedUser)return;
  const res=await fetch(API+'/api/push/register',{
    method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify(method==='POST'?{platform:'android',endpoint}:{endpoint}),
  });
  if(!res.ok)throw Error('Сервер Connect отклонил регистрацию уведомлений (HTTP '+res.status+')');
}
/** Register a signed-in user with the existing Connect push_devices server API. */
export function subscribeNativePush(ownerId:string,open:(route:NativePushDestination)=>void,onError:(error:string)=>void):()=>void{
  let alive=true;
  onOpen=open;
  if(bufferedOpen){open(bufferedOpen);bufferedOpen=null;}
  const foreground=onMessage(getMessaging(), async message=>{try{await handleNativePush(normalizeFcmData(message.data)||undefined);}catch(e){console.warn('Connect native notification:',e);}});
  const presses=notifee.onForegroundEvent(({type,detail})=>{
    if(type===EventType.PRESS||type===EventType.ACTION_PRESS)deliverOpen(detail.notification?.data);
  });
  const tokenRefresh=onTokenRefresh(getMessaging(), token=>{void sendRegistration(token,'POST',ownerId).catch(e=>{if(alive)onError(String(e));});});
  void (async()=>{
    try{
      await SecureStore.setItemAsync(DEVICE_ACTIVE_KEY,'yes');
      await ensureChannels();
      const permission=await notifee.requestPermission();
      if(permission.authorizationStatus===0){if(alive)onError('Разрешите уведомления Connect в настройках Android.');return;}
      const token=await getToken(getMessaging());
      if(!alive)return;
      await sendRegistration(token,'POST',ownerId);
      const initial=await notifee.getInitialNotification();
      if(alive&&initial?.notification?.data)deliverOpen(initial.notification.data);
    }catch(e){if(alive)onError('Ошибка регистрации уведомлений: '+String(e));}
  })();
  return ()=>{
    alive=false;foreground();presses();tokenRefresh();
    if(onOpen===open)onOpen=null;
  };
}

export async function dismissChatPush(conversationId:string){
  if(UUID.test(conversationId))await notifee.cancelNotification('chat:'+conversationId);
}

/** Do not keep showing personal notifications after account sign-out. */
export async function disableNativePush(){
  await SecureStore.setItemAsync(DEVICE_ACTIVE_KEY,'no');
  try{
    const {data:{session}}=await db.auth.getSession();
    const token=await getToken(getMessaging());
    if(session&&token)await sendRegistration(token,'DELETE',session.user.id);
  }catch(e){console.warn('Connect: FCM token deregistration deferred',e);}
  await notifee.cancelAllNotifications();
}


/** Firebase permits object values, but Connect notification payloads must be strings. */
function normalizeFcmData(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = Object.create(null) as Record<string, string>;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') output[key] = item;
    else if (item !== null && item !== undefined) {
      try { const encoded = JSON.stringify(item); if (typeof encoded === 'string') output[key] = encoded; } catch { /* ignore invalid values */ }
    }
  }
  return output;
}
