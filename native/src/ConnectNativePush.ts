/** Connect Android native FCM transport. No WebView or Supabase service-role secrets. */
import {getMessaging,getToken,onMessage,onTokenRefresh,setBackgroundMessageHandler} from '@react-native-firebase/messaging';
import notifee, {AndroidCategory, AndroidImportance, AndroidVisibility, EventType} from '@notifee/react-native';
import * as SecureStore from 'expo-secure-store';
import {db} from './backend';
import {showIncomingSystemCall,endSystemCall,handleCallNotificationAction} from './ConnectNativeTelecom';
import {getConnectSoundChannel} from './ConnectNativeSoundSettings';

const API=(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'');
const DEVICE_ACTIVE_KEY='connect-native-fcm-authorized-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES='connect-native-messages-v1';
const CALLS='connect-native-calls-v1';
const READ_KEY='connect-native-read-marker-v1-';
// connect-native-push-pref-phase9: preserve the same user-facing settings as PWA.
const NOTIFICATION_KEY='connect-native-notifications-v1';
const LAST_RECEIVED_KEY='connect-native-fcm-last-message-v1';
const LAST_REGISTERED_KEY='connect-native-fcm-last-registration-v1';
type NotificationPrefs={enabled:boolean;vibrate:boolean;sound:'soft'|'bright'|'gentle'|'silent'};
async function notificationPrefs():Promise<NotificationPrefs>{
  const fallback:NotificationPrefs={enabled:true,vibrate:true,sound:'soft'};
  try{
    const raw=await SecureStore.getItemAsync(NOTIFICATION_KEY);
    if(!raw)return fallback;
    const parsed=JSON.parse(raw) as Partial<NotificationPrefs>;
    return {enabled:typeof parsed.enabled==='boolean'?parsed.enabled:true,
      vibrate:typeof parsed.vibrate==='boolean'?parsed.vibrate:true,
      sound:['soft','bright','gentle','silent'].includes(parsed.sound||'') ? parsed.sound as NotificationPrefs['sound'] : 'soft'};
  }catch{return fallback;}
}

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
  await Promise.all([getConnectSoundChannel('messages'),getConnectSoundChannel('calls')]);
}
const pendingReadWrites=new Map<string,Promise<void>>();
/** A local read marker stops delayed FCM messages from resurrecting read alerts. */
export async function rememberReadAt(conversationId:string,iso:string){
  if(!UUID.test(conversationId)||!Number.isFinite(Date.parse(iso)))return;
  const key=READ_KEY+conversationId;
  // Foreground reads and FCM read receipts can overlap. Serialize per chat so
  // a slower older write cannot replace a newer high-water mark.
  const write=(pendingReadWrites.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const old=await SecureStore.getItemAsync(key);
    if(!old||Date.parse(iso)>Date.parse(old))await SecureStore.setItemAsync(key,iso);
  });
  pendingReadWrites.set(key,write);
  try{await write;}finally{if(pendingReadWrites.get(key)===write)pendingReadWrites.delete(key);}
}
/** Handles the data-only FCM payloads already sent by the Connect server. */
export async function handleNativePush(data:Data|undefined){
  if(!data)return;
  if(data.messageId||data.kind==='message'||data.kind==='chat')
    await SecureStore.setItemAsync(LAST_RECEIVED_KEY,new Date().toISOString()).catch(()=>{});
  if(data.kind==='read'){
    if(data.conversationId&&UUID.test(data.conversationId)){
      if(data.readAt)await rememberReadAt(data.conversationId,data.readAt);
      if(data.readAt)await dismissChatPush(data.conversationId,data.readAt);
    }
    return;
  }
  if(data.kind==='call-ended'){
    if(data.callId&&UUID.test(data.callId))await endSystemCall(data.callId);
    return;
  }
  if(await SecureStore.getItemAsync(DEVICE_ACTIVE_KEY)!=='yes')return;
  const prefs=await notificationPrefs();
  if(!prefs.enabled)return;
  if(data.kind==='incoming-call'&&data.callId&&UUID.test(data.callId)){
    await ensureChannels();
    await showIncomingSystemCall(data.callId,data.callerName||'Собеседник',data.conversationId||null);
    return;
  }
  if((data.kind==='message'||data.kind==='chat'||(!data.kind && data.messageId))&&data.conversationId&&UUID.test(data.conversationId)){
    if(data.conversationId===visibleConversation)return;
    const lastRead=await SecureStore.getItemAsync(READ_KEY+data.conversationId);
    if(data.createdAt&&lastRead&&Number.isFinite(Date.parse(data.createdAt))&&
      Date.parse(data.createdAt)<=Date.parse(lastRead))return;
    const channelId=await getConnectSoundChannel('messages',{silent:prefs.sound==='silent',vibrate:prefs.vibrate,tone:prefs.sound});
    await notifee.displayNotification({
      id:'chat:'+data.conversationId,
      title:'Connect · Новое сообщение',body:'Откройте переписку, чтобы прочитать сообщение',
      data:{kind:'message',conversationId:data.conversationId,createdAt:data.createdAt||''},
      android:{channelId,category:AndroidCategory.MESSAGE,importance:AndroidImportance.HIGH,
        visibility:AndroidVisibility.PRIVATE,pressAction:{id:'default'},autoCancel:true},
    });
  }
}

/** Must run at JavaScript entry-point, including when Android starts a headless task. */
export function installNativePushBackgroundHandlers(){
  setBackgroundMessageHandler(getMessaging(), async message=>{await handleNativePush(normalizeFcmData(message.data)||undefined);});
  notifee.onBackgroundEvent(async ({type,detail})=>{
    if(type===EventType.ACTION_PRESS)
      await handleCallNotificationAction(detail.pressAction?.id,detail.notification?.data);
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
    if(type===EventType.ACTION_PRESS && detail.pressAction?.id?.startsWith('connect-')){
      void handleCallNotificationAction(detail.pressAction.id,detail.notification?.data);
      return;
    }
    if(type===EventType.PRESS||type===EventType.ACTION_PRESS)deliverOpen(detail.notification?.data);
  });
  const tokenRefresh=onTokenRefresh(getMessaging(), token=>{void sendRegistration(token,'POST',ownerId).catch(e=>{if(alive)onError(String(e));});});
  void (async()=>{
    try{
      await SecureStore.setItemAsync(DEVICE_ACTIVE_KEY,'yes');
      const remote=await db.from('notification_preferences').select('enabled,sound,vibrate').eq('user_id',ownerId).maybeSingle();
      if(!remote.error&&remote.data){
        const p=remote.data;
        if(typeof p.enabled==='boolean'&&typeof p.vibrate==='boolean'&&
          ['soft','bright','gentle','silent'].includes(p.sound||''))
          await SecureStore.setItemAsync(NOTIFICATION_KEY,JSON.stringify(p));
      }
      await ensureChannels();
      const permission=await notifee.requestPermission();
      if(permission.authorizationStatus===0){if(alive)onError('Разрешите уведомления Connect в настройках Android.');return;}
      const token=await getToken(getMessaging());
      if(!alive)return;
      await sendRegistration(token,'POST',ownerId);
      await SecureStore.setItemAsync(LAST_REGISTERED_KEY,new Date().toISOString()).catch(()=>{});
      const initial=await notifee.getInitialNotification();
      if(alive&&initial?.notification?.data){
        if(initial.pressAction?.id==='connect-answer')
          await handleCallNotificationAction('connect-answer',initial.notification.data);
        deliverOpen(initial.notification.data);
      }
    }catch(e){if(alive)onError('Ошибка регистрации уведомлений: '+String(e));}
  })();
  return ()=>{
    alive=false;foreground();presses();tokenRefresh();
    if(onOpen===open)onOpen=null;
  };
}

export async function dismissChatPush(conversationId:string,readAt?:string){
  if(!UUID.test(conversationId))return;
  const boundary=readAt?Date.parse(readAt):null;
  if(boundary!==null&&!Number.isFinite(boundary))return;
  const displayed=await notifee.getDisplayedNotifications().catch(()=>[]);
  await Promise.all(displayed.filter(item=>{
    const notification=item.notification;
    if(!notification||notification.data?.conversationId!==conversationId||typeof notification.id!=='string')return false;
    // Incoming-call notifications carry conversationId too; reading messages
    // must never cancel a call alert in the same conversation.
    if(notification.id!=='chat:'+conversationId&&notification.data.kind!=='message'&&notification.data.kind!=='chat')return false;
    if(boundary===null)return true;
    const createdAt=Date.parse(String(notification.data.createdAt||''));
    return Number.isFinite(createdAt)&&createdAt<=boundary;
  }).map(item=>notifee.cancelNotification(item.notification!.id!)));
}


/** Explicit diagnostic: checks Android system permission, re-registers FCM,
 * then creates a safe local notification to validate OS display / sound channel.
 * A local test does NOT prove the server can send FCM. */
export async function testNativeMessagePush(ownerId:string):Promise<string>{
  if(!ownerId)throw Error('Сначала войдите в Connect');
  const permission=await notifee.requestPermission();
  if(permission.authorizationStatus===0)throw Error('Система запретила уведомления для Connect. Включите их в настройках Android.');
  const settings=await notifee.getNotificationSettings();
  if(settings.authorizationStatus===0)throw Error('Уведомления Connect отключены в Android');
  const token=await getToken(getMessaging());
  if(!token)throw Error('Firebase не выдал токен. Проверьте Google Play Services и интернет.');
  await sendRegistration(token,'POST',ownerId);
  await SecureStore.setItemAsync(LAST_REGISTERED_KEY,new Date().toISOString());
  const prefs=await notificationPrefs();
  const channelId=await getConnectSoundChannel('messages',{
    silent:prefs.sound==='silent',vibrate:prefs.vibrate,tone:prefs.sound,
  });
  const channel=await notifee.getChannel(channelId);
  if(!channel || channel.blocked || channel.importance===AndroidImportance.NONE)
    throw Error('Канал сообщений заблокирован в системных настройках Android');
  await notifee.displayNotification({
    id:'connect-native-local-test-v1',title:'Connect · Проверка уведомлений',
    body:'Если видите это уведомление, системный канал работает.',
    data:{kind:'diagnostic'},
    android:{channelId,category:AndroidCategory.MESSAGE,importance:AndroidImportance.HIGH,
      visibility:AndroidVisibility.PRIVATE,pressAction:{id:'default'},autoCancel:true},
  });
  const last=await SecureStore.getItemAsync(LAST_RECEIVED_KEY);
  return 'Разрешение Android есть, FCM-токен зарегистрирован, тест отправлен в шторку. '+
    (last?'Последний входящий FCM: '+new Date(last).toLocaleString('ru-RU'):
      'Входящие FCM ещё не зафиксированы. Проверьте сообщение от другого пользователя.');
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
