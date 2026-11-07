/** Connect Android: self-managed Telecom and lock-screen call presentation.
 * The WebRTC/Supabase call is authoritative. Telecom never creates a second call.
 */
import {Platform} from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import notifee,{AndroidCategory,AndroidImportance,AndroidVisibility} from '@notifee/react-native';
import * as SecureStore from 'expo-secure-store';
import {db} from './backend';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL='connect-native-calls-v1';
const PENDING='connect-native-telecom-action-v1';
export type TelecomAction='answer'|'end';
type SavedAction={action:TelecomAction;callId:string;time:number};
let initialized:Promise<boolean>|null=null;
let installed=false;
let listener:((action:TelecomAction,callId:string)=>void)|null=null;
const openCalls=new Set<string>();
const ignoredEnd=new Set<string>();
const lastDelivery=new Map<string,number>();

function dispatch(action:TelecomAction,id:string){
  if(!UUID.test(id))return;
  const key=action+':'+id,now=Date.now();
  if(now-(lastDelivery.get(key)||0)<750)return;
  lastDelivery.set(key,now);
  if(listener)listener(action,id);
  else void SecureStore.setItemAsync(PENDING,JSON.stringify({action,callId:id,time:now} satisfies SavedAction));
}

/** Install listeners at index.js startup, including Headless JS from an FCM push. */
export function installTelecomEventHandlers(){
  if(installed||Platform.OS!=='android')return;
  installed=true;
  RNCallKeep.addEventListener('answerCall',({callUUID})=>dispatch('answer',callUUID));
  RNCallKeep.addEventListener('endCall',({callUUID})=>{
    if(ignoredEnd.delete(callUUID))return;
    openCalls.delete(callUUID);dispatch('end',callUUID);
  });
  RNCallKeep.addEventListener('createIncomingConnectionFailed',({callUUID})=>{
    openCalls.delete(callUUID);
    // If Telecom rejects a new self-managed connection, do not leave a ghost call.
    dispatch('end',callUUID);
  });
  // Telecom asks self-managed apps to draw their own incoming UI. The Notifee
  // call notification is displayed below whenever the call is presented.
  RNCallKeep.addEventListener('showIncomingCallUi',()=>{});
}

async function setup():Promise<boolean>{
  if(Platform.OS!=='android')return false;
  installTelecomEventHandlers();
  if(!initialized)initialized=(async()=>{
    try{
      await RNCallKeep.setup({
        ios:{appName:'Connect'},
        android:{alertTitle:'Телефонные вызовы Connect',alertDescription:'Разрешите Connect управлять аудиозвонками.',
          cancelButton:'Отмена',okButton:'Разрешить',additionalPermissions:[],selfManaged:true},
      });
      RNCallKeep.setAvailable(true);
      return true;
    }catch(e){console.warn('Connect Android Telecom unavailable:',e);return false;}
  })();
  return initialized;
}

/** Foreground callback for native Telecom events and notification action presses. */
export function subscribeSystemTelecom(onAction:(action:TelecomAction,callId:string)=>void):()=>void{
  installTelecomEventHandlers();
  listener=onAction;
  void setup();
  let active=true;
  void (async()=>{
    try{
      const raw=await SecureStore.getItemAsync(PENDING);
      if(!raw||!active)return;
      await SecureStore.deleteItemAsync(PENDING);
      const event=JSON.parse(raw) as SavedAction;
      if(UUID.test(event.callId)&&Date.now()-event.time<70000)onAction(event.action,event.callId);
    }catch(e){console.warn('Connect pending call action:',e);}
  })();
  return()=>{active=false;if(listener===onAction)listener=null;};
}

async function ensureCallChannel(){
  await notifee.createChannel({id:CHANNEL,name:'Connect · Аудиозвонки',importance:AndroidImportance.HIGH,
    sound:'default',vibration:true});
}

export async function showIncomingSystemCall(callId:string,callerName:string,conversationId:string|null){
  if(!UUID.test(callId)||Platform.OS!=='android')return;
  const available=await setup();
  if(available&&!openCalls.has(callId)){
    try{
      RNCallKeep.displayIncomingCall(callId,callId,callerName,'generic',false);
      openCalls.add(callId);
    }catch(e){console.warn('Connect Telecom incoming:',e);}
  }
  await ensureCallChannel();
  await notifee.displayNotification({
    id:'call:'+callId,title:'Connect · Входящий звонок',body:`Звонит ${callerName}`,
    data:{kind:'incoming-call',callId,conversationId:conversationId||''},
    android:{channelId:CHANNEL,category:AndroidCategory.CALL,importance:AndroidImportance.HIGH,
      visibility:AndroidVisibility.PRIVATE,pressAction:{id:'default'},
      fullScreenAction:{id:'default'},onlyAlertOnce:true,timeoutAfter:65000,
      actions:[
        {title:'Отклонить',pressAction:{id:'connect-decline'}},
        {title:'Ответить',pressAction:{id:'connect-answer',launchActivity:'default'}},
      ]},
  });
}

export async function showOutgoingSystemCall(callId:string,peerName:string){
  if(!UUID.test(callId)||!await setup()||openCalls.has(callId))return;
  try{RNCallKeep.startCall(callId,callId,peerName,'generic',false);openCalls.add(callId);}
  catch(e){console.warn('Connect Telecom outgoing:',e);}
}

export async function answerSystemCall(callId:string){
  if(!UUID.test(callId))return;
  if(await setup())try{RNCallKeep.answerIncomingCall(callId);}catch{}
}

export async function activeSystemCall(callId:string){
  if(!UUID.test(callId)||!await setup())return;
  try{RNCallKeep.setCurrentCallActive(callId);}catch(e){console.warn('Connect Telecom active:',e);}
  await notifee.cancelNotification('call:'+callId).catch(()=>{});
}

export async function endSystemCall(callId:string){
  if(!UUID.test(callId))return;
  if(openCalls.delete(callId)){
    ignoredEnd.add(callId);
    try{RNCallKeep.endCall(callId);}catch{}
    setTimeout(()=>ignoredEnd.delete(callId),3500);
  }
  await notifee.cancelNotification('call:'+callId).catch(()=>{});
}

/** Handles Notifee ACTION_PRESS even if the app is running as a headless task. */
export async function handleCallNotificationAction(action:string|undefined,raw:Record<string,unknown>|undefined){
  const id=raw?.callId;
  if(typeof id!=='string'||!UUID.test(id))return;
  if(action==='connect-decline'){
    // Do not confuse decline with generic hangup: this is a ringing call.
    try{await db.rpc('connect_finish_audio_call',{p_call_id:id,p_reason:'decline'});}catch(e){console.warn('Connect decline:',e);}
    await endSystemCall(id);
    dispatch('end',id);
  }else if(action==='connect-answer'){
    // Do not capture microphone from a background handler; launch the app first.
    dispatch('answer',id);
    try{RNCallKeep.backToForeground();}catch{}
  }
}
