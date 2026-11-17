/** Connect Android native FCM transport. No WebView or Supabase service-role secrets. */
import {getMessaging,getToken,onMessage,onTokenRefresh,setBackgroundMessageHandler} from '@react-native-firebase/messaging';
import notifee, {AndroidCategory, AndroidImportance, AndroidVisibility, EventType} from '@notifee/react-native';
import {AppState,NativeModules,DeviceEventEmitter} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {db} from './backend';
import {chatTimeKey} from '../web/lib/chat-order';
import {showIncomingSystemCall,endSystemCall,handleCallNotificationAction} from './ConnectNativeTelecom';
import {getConnectSoundChannel} from './ConnectNativeSoundSettings';
import {NOTIFICATION_KEY,parseNotificationPrefs,mergeServerNotificationPrefs,type NotificationPrefs} from '../web/lib/android-sound-policy';

const API=(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'');
const OPEN_KEY='connect-native-push-open-v1';
const DEVICE_ACTIVE_KEY='connect-native-fcm-authorized-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES='connect-native-messages-v1';
const CALLS='connect-native-calls-v1';
const READ_KEY='connect-native-read-marker-v1-';
const SHOWN_KEY='connect-native-shown-message-v1-';
// connect-native-push-pref-phase9: preserve the same user-facing settings as PWA.
const LAST_RECEIVED_KEY='connect-native-fcm-last-message-v1';
const LAST_REGISTERED_KEY='connect-native-fcm-last-registration-v1';
async function notificationPrefs():Promise<NotificationPrefs>{
  try{return parseNotificationPrefs(JSON.parse(await SecureStore.getItemAsync(NOTIFICATION_KEY)||'null'));}
  catch{return parseNotificationPrefs(null);}
}

type Data=Record<string,string|undefined>;
const TRACE_KEY='connect-native-push-trace-v1';
let traceWrites=Promise.resolve();
/** Bounded metadata only. Never pass arbitrary FCM fields, text, URLs or tokens. */
async function tracePush(stage:'received'|'shown'|'read'|'dismissed'|'registered'|'registration-failed',conversationId='',eventAt='',messageId=''){
  const at=new Date().toISOString();
  traceWrites=traceWrites.catch(()=>{}).then(async()=>{
    try{
      const raw=JSON.parse(await SecureStore.getItemAsync(TRACE_KEY)||'[]');
      const rows=Array.isArray(raw)?raw.slice(-15):[];
      rows.push({stage,at,...(UUID.test(conversationId)?{conversationId}:{}),
        ...(Number.isFinite(Date.parse(eventAt))?{eventAt}:{}),
        ...(/^[a-zA-Z0-9_-]{1,80}$/.test(messageId)?{messageId}:{})});
      await SecureStore.setItemAsync(TRACE_KEY,JSON.stringify(rows));
    }catch{console.warn('Connect push diagnostic storage unavailable');}
  });
  await traceWrites;
}
export async function getNativePushDiagnostics():Promise<unknown[]>{
  await traceWrites;
  try{const rows=JSON.parse(await SecureStore.getItemAsync(TRACE_KEY)||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}
}

export type NativePushDestination={kind:'chat';conversationId:string}|{kind:'call';callId:string;conversationId:string|null}|{kind:'calls'};
let onOpen:((destination:NativePushDestination)=>void)|null=null;
let bufferedOpen:NativePushDestination|null=null;
let visibleConversation:string|null=null;
export function setVisibleConversation(id:string|null){visibleConversation=id;}
function route(raw:Record<string,unknown>|undefined):NativePushDestination|null {
  if(!raw)return null;
  if(raw.kind==='missed-call')return {kind:'calls'};
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
const pendingAlerts=new Map<string,Promise<void>>();
/** Serialize both display and cancellation: the same chat ID is reused by Android. */
async function updateChatAlert(conversationId:string,operation:()=>Promise<void>){
  const task=(pendingAlerts.get(conversationId)||Promise.resolve()).catch(()=>{}).then(operation);
  pendingAlerts.set(conversationId,task);
  try{await task;}finally{if(pendingAlerts.get(conversationId)===task)pendingAlerts.delete(conversationId);}
}
/** A local read marker stops delayed FCM messages from resurrecting read alerts. */
export async function rememberReadAt(conversationId:string,iso:string){
  if(!UUID.test(conversationId)||!Number.isFinite(Date.parse(iso)))return;
  const key=READ_KEY+conversationId;
  // Foreground reads and FCM read receipts can overlap. Serialize per chat so
  // a slower older write cannot replace a newer high-water mark.
  const write=(pendingReadWrites.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const old=await SecureStore.getItemAsync(key);
    if(!old||!chatTimeKey(old)||chatTimeKey(iso)>chatTimeKey(old))await SecureStore.setItemAsync(key,iso);
  });
  pendingReadWrites.set(key,write);
  try{await write;await tracePush('read',conversationId,iso);}finally{if(pendingReadWrites.get(key)===write)pendingReadWrites.delete(key);}
}
/** Handles the data-only FCM payloads already sent by the Connect server. */
export async function handleNativePush(data:Data|undefined){
  if(!data)return;
  await tracePush('received',data.conversationId,data.createdAt,data.messageId);
  if(data.messageId||data.kind==='message'||data.kind==='chat')
    await SecureStore.setItemAsync(LAST_RECEIVED_KEY,new Date().toISOString()).catch(()=>{});
  if(data.kind==='read'){
    if(data.conversationId&&UUID.test(data.conversationId)){
      if(data.readAt)await rememberReadAt(data.conversationId,data.readAt);
      if(data.readAt)await dismissChatPush(data.conversationId,data.readAt);
    }
    return;
  }
  if(data.kind==='missed-call'){await NativeModules?.ConnectCallCoordinator?.receiveMissed?.(JSON.stringify(data));return;}
  if(data.kind==='call-ended'){
    if(data.callId&&UUID.test(data.callId))await endSystemCall(data.callId);
    return;
  }
  if(await SecureStore.getItemAsync(DEVICE_ACTIVE_KEY)!=='yes')return;
  if(data.kind==='incoming-call'&&data.callId&&UUID.test(data.callId)){
    await ensureChannels();
    await showIncomingSystemCall(data.callId,data.callerName||'Собеседник',data.conversationId||null);
    return;
  }
  const prefs=await notificationPrefs();
  if(!prefs.enabled)return;
  if((data.kind==='message'||data.kind==='chat'||(!data.kind && data.messageId))&&data.conversationId&&UUID.test(data.conversationId)){
    const conversationId=data.conversationId;
    // FCM delivery may be reordered or concurrent. Keep the newest unread
    // alert, otherwise a delayed old push can replace it and then be removed by
    // an old read receipt, hiding a newer unread message.
    await updateChatAlert(conversationId,async()=>{
      if(conversationId===visibleConversation&&AppState.currentState==='active')return;
      const previous=await SecureStore.getItemAsync(SHOWN_KEY+conversationId);
      if(previous){
        let shown:{messageId?:string;createdAt?:string}={};
        try{shown=JSON.parse(previous)||{};}catch{/* A damaged dedup marker must not drop future pushes. */}
        if(data.messageId&&shown.messageId===data.messageId)return;
        if(chatTimeKey(data.createdAt||'')&&chatTimeKey(data.createdAt!)<chatTimeKey(shown.createdAt||''))return;
      }
      const lastRead=await SecureStore.getItemAsync(READ_KEY+conversationId);
      const created=chatTimeKey(data.createdAt||'');
      if(lastRead&&created&&created<=chatTimeKey(lastRead))return;
      const current=(await notifee.getDisplayedNotifications()).find(item=>item.notification.id==='chat:'+conversationId)?.notification;
      const currentData=current?.data;
      const currentTime=typeof currentData?.createdAt==='string'?chatTimeKey(currentData.createdAt):'';
      if(created&&currentTime&&created<currentTime)return;
      if(data.messageId&&currentData?.messageId===data.messageId)return;
      const channelId=await getConnectSoundChannel('messages',{silent:prefs.sound==='silent',vibrate:prefs.vibrate,tone:prefs.sound});
      await notifee.displayNotification({
        id:'chat:'+conversationId,
        title:'Connect · Новое сообщение',body:'Откройте переписку, чтобы прочитать сообщение',
        data:{kind:'message',conversationId,createdAt:data.createdAt||'',messageId:data.messageId||''},
        android:{channelId,category:AndroidCategory.MESSAGE,importance:AndroidImportance.HIGH,
          visibility:AndroidVisibility.PRIVATE,pressAction:{id:'default'},autoCancel:true,onlyAlertOnce:false},
      });
      await tracePush('shown',conversationId,data.createdAt,data.messageId);
      await SecureStore.setItemAsync(SHOWN_KEY+conversationId,JSON.stringify({messageId:data.messageId||'',createdAt:data.createdAt||''}));
    });
  }
}

/** Must run at JavaScript entry-point, including when Android starts a headless task. */
export function installNativePushBackgroundHandlers(){
  setBackgroundMessageHandler(getMessaging(), async message=>{await handleNativePush(normalizeFcmData(message.data)||undefined);});
  notifee.onBackgroundEvent(async ({type,detail})=>{
    if(type===EventType.ACTION_PRESS&&detail.pressAction?.id?.startsWith('connect-'))
      await handleCallNotificationAction(detail.pressAction?.id,detail.notification?.data);
    else if(type===EventType.PRESS||type===EventType.ACTION_PRESS){const destination=route(detail.notification?.data);if(destination){await SecureStore.setItemAsync(OPEN_KEY,JSON.stringify({raw:detail.notification?.data,time:Date.now()}));deliverOpen(detail.notification?.data);}}
  });
}
async function sendRegistration(endpoint:string, method:'POST'|'DELETE',expectedUser:string){
  const {data:{session}}=await db.auth.getSession();
  if(!session||session.user.id!==expectedUser){
    if(method==='POST')throw Error('Аккаунт изменился. Подключите уведомления повторно.');
    return;
  }
  const res=await fetch(API+'/api/push/register',{
    method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify(method==='POST'?{platform:'android',endpoint}:{endpoint}),
  });
  if(!res.ok){await tracePush('registration-failed');throw Error('Сервер Connect отклонил регистрацию уведомлений (HTTP '+res.status+')');}
  if(method==='POST')await tracePush('registered');
}
export async function registerNativePushNow(ownerId:string){
  const permission=await notifee.requestPermission();
  if(permission.authorizationStatus===0)throw Error('Разрешите уведомления Connect в Android');
  const token=await getToken(getMessaging());if(!token)throw Error('Firebase не выдал токен устройства.');
  await sendRegistration(token,'POST',ownerId);
  await SecureStore.setItemAsync(DEVICE_ACTIVE_KEY,'yes');
  await SecureStore.setItemAsync(LAST_REGISTERED_KEY,new Date().toISOString()).catch(()=>{});
}

export type NativePushSubscriptionStatus={state:'active'|'permission'|'disabled'|'unregistered'|'temporary';verifiedAt?:string};
/** A registration acknowledgement confirms this account/device in the Connect server.
 * Do not expose FCM tokens, endpoints or auth headers to the embedded WebView.
 * A successful POST is NOT proof an FCM push reached the device.
 */
export async function getNativePushSubscriptionStatus(ownerId:string,manual=false):Promise<NativePushSubscriptionStatus>{
  if(!UUID.test(ownerId))return {state:'unregistered'};
  try{
    const permission=manual?await notifee.requestPermission():await notifee.getNotificationSettings();
    if(permission.authorizationStatus<=0)return {state:'permission'};
    const local=await notificationPrefs();
    if(!local.enabled)return {state:'disabled'};
    const remote=await db.from('notification_preferences').select('enabled').eq('user_id',ownerId).maybeSingle();
    if(remote.error)return {state:'temporary'};
    if(remote.data?.enabled===false)return {state:'disabled'};
    const token=await getToken(getMessaging());
    if(!token)return {state:'unregistered'};
    await sendRegistration(token,'POST',ownerId);
    const verifiedAt=new Date().toISOString();
    await SecureStore.setItemAsync(DEVICE_ACTIVE_KEY,'yes');
    await SecureStore.setItemAsync(LAST_REGISTERED_KEY,verifiedAt).catch(()=>{});
    return {state:'active',verifiedAt};
  }catch{return {state:'temporary'};}
}

/** Register a signed-in user with the existing Connect push_devices server API. */
export function subscribeNativePush(ownerId:string,open:(route:NativePushDestination)=>void,onError:(error:string)=>void):()=>void{
  let alive=true;
  onOpen=open;
  let lastRepair=Date.now(),repairRunning=false,retryTimer:ReturnType<typeof setTimeout>|null=null;
  let retryCount=0;
  const scheduleRetry=()=>{
    if(!alive||retryTimer!==null)return;
    const delay=[30000,60000,120000,240000][Math.min(retryCount++,3)];
    retryTimer=setTimeout(()=>{retryTimer=null;void repair();},delay);
  };
  const repair=async()=>{
    if(!alive||repairRunning||AppState.currentState!=='active'||Date.now()-lastRepair<12000)return;
    lastRepair=Date.now();repairRunning=true;
    try{
      // No Android permission dialog from background retry, unlike explicit user action.
      const permission=await notifee.getNotificationSettings();
      if(permission.authorizationStatus<=0)return;
      const token=await getToken(getMessaging());
      if(!alive||!token)return;
      await sendRegistration(token,'POST',ownerId);
      await SecureStore.setItemAsync(LAST_REGISTERED_KEY,new Date().toISOString()).catch(()=>{});
      retryCount=0;
      if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
    }catch{if(alive)scheduleRetry();}
    finally{repairRunning=false;}
  };
  const drainOpen=async()=>{try{if(await NativeModules?.ConnectCallCoordinator?.consumeMissedOpen?.(ownerId)){if(alive)open({kind:'calls'});}const raw=await SecureStore.getItemAsync(OPEN_KEY);if(!raw||!alive)return;await SecureStore.deleteItemAsync(OPEN_KEY);const saved=JSON.parse(raw);if(Date.now()-saved.time<120000)deliverOpen(saved.raw);}catch{}};
  const missedPress=DeviceEventEmitter?.addListener?.('connect:missed-changed',(event:any)=>{if(event?.userId===ownerId)void drainOpen();});
  const resumes=AppState.addEventListener('change',state=>{if(state==='active'){void drainOpen();void repair();}});
  const periodic=setInterval(()=>{void repair();},15*60*1000);
  void drainOpen();
  if(bufferedOpen){open(bufferedOpen);bufferedOpen=null;}
  const foreground=onMessage(getMessaging(), async message=>{try{await handleNativePush(normalizeFcmData(message.data)||undefined);}catch(e){console.warn('Connect native notification:',e);}});
  const presses=notifee.onForegroundEvent(({type,detail})=>{
    if(type===EventType.ACTION_PRESS && detail.pressAction?.id?.startsWith('connect-')){
      void handleCallNotificationAction(detail.pressAction.id,detail.notification?.data);
      return;
    }
    if(type===EventType.PRESS||type===EventType.ACTION_PRESS)deliverOpen(detail.notification?.data);
  });
  const tokenRefresh=onTokenRefresh(getMessaging(), token=>{void sendRegistration(token,'POST',ownerId).then(()=>SecureStore.setItemAsync(LAST_REGISTERED_KEY,new Date().toISOString())).catch(e=>{if(alive){onError(String(e));scheduleRetry();}});});
  void (async()=>{
    try{
      await SecureStore.setItemAsync(DEVICE_ACTIVE_KEY,'yes');
      const remote=await db.from('notification_preferences').select('enabled,sound,vibrate').eq('user_id',ownerId).maybeSingle();
      if(!remote.error&&remote.data){
        const p=remote.data;
        if(typeof p.enabled==='boolean'&&typeof p.vibrate==='boolean'&&
          ['soft','bright','gentle','silent'].includes(p.sound||''))
          await SecureStore.setItemAsync(NOTIFICATION_KEY,JSON.stringify(mergeServerNotificationPrefs(parseNotificationPrefs(p),await notificationPrefs())));
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
    }catch(e){if(alive){onError('Ошибка регистрации уведомлений: '+String(e));scheduleRetry();}}
  })();
  return ()=>{
    alive=false;if(retryTimer!==null)clearTimeout(retryTimer);clearInterval(periodic);foreground();presses();tokenRefresh();resumes.remove();missedPress?.remove();
    if(onOpen===open)onOpen=null;
  };
}

export async function dismissChatPush(conversationId:string,readAt?:string){
  if(!UUID.test(conversationId))return;
  const boundary=readAt?chatTimeKey(readAt):null;
  if(boundary!==null&&!boundary)return;
  await updateChatAlert(conversationId,async()=>{
  const displayed=await notifee.getDisplayedNotifications();
  const children=displayed.filter(item=>item.notification?.data?.conversationId===conversationId&&['message','chat'].includes(String(item.notification.data.kind))&&!item.notification.android?.groupSummary);
  const unread=children.some(item=>{const at=chatTimeKey(String(item.notification?.data?.createdAt||''));return boundary!==null&&(!at||at>boundary);});
  await Promise.all(displayed.filter(item=>{
    const notification=item.notification;
    if(!notification||notification.data?.conversationId!==conversationId||typeof notification.id!=='string')return false;
    // Incoming-call notifications carry conversationId too; reading messages
    // must never cancel a call alert in the same conversation.
    if(notification.android?.groupSummary&&['message','chat','message-summary'].includes(String(notification.data.kind)))return !unread;
    if(notification.id!=='chat:'+conversationId&&notification.data.kind!=='message'&&notification.data.kind!=='chat')return false;
    if(boundary===null)return true;
    const createdAt=chatTimeKey(String(notification.data.createdAt||''));
    return Boolean(createdAt)&&createdAt<=boundary;
  }).map(async item=>{await notifee.cancelNotification(item.notification!.id!);await tracePush('dismissed',conversationId,readAt);}));
  });
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
      visibility:AndroidVisibility.PRIVATE,pressAction:{id:'default'},autoCancel:true,onlyAlertOnce:false},
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
