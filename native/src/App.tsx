import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,AppState,BackHandler,DeviceEventEmitter,Linking,NativeModules,Text,View,Pressable} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import {WebView,WebViewMessageEvent} from 'react-native-webview';
import notifee from '@notifee/react-native';
import {db,mediaUrl,type Profile} from './backend';
import {parseHybridMessage,CONNECT_ORIGIN} from './hybridProtocol';
import {useConnectNativeVoice} from './ConnectNativeVoice';
import {subscribeNativePush,registerNativePushNow,disableNativePush,setVisibleConversation,rememberReadAt,dismissChatPush} from './ConnectNativePush';
import {chooseConnectSound,getConnectSoundPreference,getConnectSoundSilence,setConnectSoundSilence,previewConnectSound,resetConnectSound,previewBuiltinSound,stopSoundPreview,type BuiltinNotificationTone} from './ConnectNativeSoundSettings';
import pwa from './generated/pwa';
import ConnectHybridRecorder,{type ConnectHybridRecorderHandle,type HybridRecordingFile} from './ConnectHybridRecorder';
import {File as NativeFile} from 'expo-file-system';
import {fromUint8Array,toUint8Array} from 'js-base64';
import {legacyWebStorage} from './hybridMigration';
import {beginSave,writeChunk,finishSave,cancelSave} from './ConnectHybridFiles';
import {Paths} from 'expo-file-system';

type FileTransfer={nonce:string;offset:number;cancelled:boolean;resolve?:()=>void;reject?:(error:Error)=>void;timer?:ReturnType<typeof setTimeout>};
/** One UI, one native call engine, one FCM registration. No native chat/navigation overlay. */
function HybridConnect(){
  const recorder=useRef<ConnectHybridRecorderHandle>(null);
  const web=useRef<WebView>(null);
  const [initial,setInitial]=useState<{access_token:string;refresh_token:string}|null|undefined>(undefined);
  const [ownerId,setOwnerId]=useState(''),[profiles,setProfiles]=useState<Profile[]>([]),[avatars,setAvatars]=useState<Record<string,string>>({});
  const [failure,setFailure]=useState(''),[revision,setRevision]=useState(0);
  const nonce=useMemo(()=>Crypto.randomUUID(),[revision]);
  const documentNonce=useRef(nonce);documentNonce.current=nonce;
  const saves=useRef(new Map<string,string>());
  const mounted=useRef(true),fileTransfers=useRef(new Map<string,FileTransfer>());
  const loaded=useRef(false),seen=useRef(new Set<string>()),active=useRef(''),queued=useRef<Array<[string,unknown]>>([]);
  const voice=useConnectNativeVoice(ownerId,profiles,avatars),voiceRef=useRef(voice);voiceRef.current=voice;
  const currentToken=useRef(''),authQueue=useRef(Promise.resolve()),busy=useRef(new Set<string>());
  const send=useCallback((type:string,data:unknown)=>{
    if(!mounted.current)return;
    if(!loaded.current){
      if(['call','sounds','lifecycle','chat','native-session'].includes(type))queued.current=queued.current.filter(([t])=>t!==type);
      if(queued.current.length>=32)queued.current.shift();
      queued.current.push([type,data]);return;
    }
    const js=`window.__connectReceive&&window.__connectReceive(${JSON.stringify(type)},${JSON.stringify(data)});true;`;
    web.current?.injectJavaScript(js);
  },[]);
  const abortTransfers=useCallback(()=>{
    for(const id of saves.current.keys())void cancelSave(id).catch(()=>{});saves.current.clear();
    for(const transfer of fileTransfers.current.values()){
      transfer.cancelled=true;if(transfer.timer)clearTimeout(transfer.timer);
      transfer.reject?.(Error('Передача записи отменена.'));transfer.reject=undefined;transfer.resolve=undefined;
    }
  },[]);
  useEffect(()=>{
    mounted.current=true;
    return()=>{mounted.current=false;abortTransfers();};
  },[abortTransfers]);
  const sendSounds=useCallback(async()=>{
    const [message,call,messageSilent,callSilent]=await Promise.all([getConnectSoundPreference('messages'),getConnectSoundPreference('calls'),getConnectSoundSilence('messages'),getConnectSoundSilence('calls')]);
    const fullScreenAllowed=await NativeModules.ConnectIncomingCallModule?.canShowFullScreenCalls?.().catch(()=>true)??true;
    send('sounds',{fullScreenAllowed,message:message?.name||'Мягкий',call:call?.name||'Connect Call',messageCustom:!!message,callCustom:!!call,messageSilent,callSilent});
  },[send]);
  useEffect(()=>{
    let alive=true;
    void db.auth.getSession().then(({data})=>{if(alive){const session=data.session;currentToken.current=session?.access_token||'';setOwnerId(session?.user.id||'');setInitial(session?{access_token:session.access_token,refresh_token:session.refresh_token}:null);}}).catch(()=>{if(alive)setInitial(null);});
    const {data:{subscription}}=db.auth.onAuthStateChange((event,session)=>{
      if(!alive)return;
      currentToken.current=session?.access_token||'';setOwnerId(session?.user.id||'');
      // Background native requests may rotate the refresh token while Chromium
      // sleeps. Return that session so the two clients cannot drift apart.
      if(event==='TOKEN_REFRESHED'||event==='SIGNED_OUT')send('native-session',session?{access_token:session.access_token,refresh_token:session.refresh_token}:null);
    });
    return()=>{alive=false;subscription.unsubscribe();};
  },[send]);
  useEffect(()=>{
    if(!ownerId){setProfiles([]);setAvatars({});return;}
    let alive=true;
    // Same profiles endpoint as PWA; existing server RLS enforces hidden-member privacy.
    void db.from('profiles').select('id,display_name,bio,avatar_path,is_blocked,online_until,last_seen_at').then(async({data,error})=>{
      if(!alive||error||!Array.isArray(data))return;
      const people=data as Profile[];setProfiles(people);
      const urls:Record<string,string>={};
      await Promise.all(people.filter(p=>p.avatar_path).map(async p=>{const {data}=await db.storage.from('connect-avatars').createSignedUrl(p.avatar_path!,3600);if(data?.signedUrl)urls[p.id]=mediaUrl(data.signedUrl);}));
      if(alive)setAvatars(urls);
    });
    return()=>{alive=false;};
  },[ownerId]);
  useEffect(()=>{
    if(!ownerId)return;
    let done=false;
    const prepare=()=>{if(!done&&AppState.currentState==='active'&&voiceRef.current.phase==='idle')void NativeModules.ConnectIncomingCallModule.prepareCalls(true).then((shown:boolean)=>{done=shown;}).catch(()=>{});};
    const timer=setTimeout(prepare,1200);
    const resume=AppState.addEventListener('change',s=>{if(s==='active')prepare();});
    return()=>{clearTimeout(timer);resume.remove();};
  },[ownerId]);
  useEffect(()=>{
    if(!ownerId)return;
    return subscribeNativePush(ownerId,dest=>{
      if(dest.kind==='chat')send('chat',dest.conversationId);
      else if(dest.kind==='calls')send('calls-open',null);
      else void voiceRef.current.checkIncoming(dest.callId);
    },message=>send('error',message));
  },[ownerId,send]);
  useEffect(()=>{if(!ownerId)return;const listener=DeviceEventEmitter.addListener('connect:missed-changed',(e:any)=>{if(e?.userId===ownerId)send('missed-changed',{userId:ownerId});});return()=>listener.remove();},[ownerId,send]);
  useEffect(()=>{
    send('call',{phase:voice.phase,callId:voice.shown?.id,remoteName:voice.remoteName,remoteAvatar:voice.remoteAvatar,elapsed:voice.elapsed,muted:voice.muted,speaker:voice.speaker,audioOutput:voice.audioOutput,error:voice.error,notice:voice.notice});
  },[voice.phase,voice.shown?.id,voice.remoteName,voice.remoteAvatar,voice.elapsed,voice.muted,voice.speaker,voice.audioOutput,voice.error,voice.notice,send]);
  useEffect(()=>{if(voice.notice)send('error',voice.notice);},[voice.notice,send]);
  useEffect(()=>{if(voice.phase!=='idle'){void recorder.current?.cancelAll();void stopSoundPreview().catch(()=>{});}},[voice.phase]);
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',state=>{
      setVisibleConversation(state==='active'?active.current||null:null);send('lifecycle',state);
      if(state==='active')void db.auth.getSession().then(({data})=>{const s=data.session;if(s&&currentToken.current!==s.access_token){currentToken.current=s.access_token;send('native-session',{access_token:s.access_token,refresh_token:s.refresh_token});}}).catch(()=>{});
      if(state!=='active')void stopSoundPreview().catch(()=>{});
      if(state==='background')abortTransfers();
    });
    const back=BackHandler.addEventListener('hardwareBackPress',()=>{web.current?.injectJavaScript("window.dispatchEvent(new Event('connect:android-back'));true;");return true;});
    return()=>{subscription.remove();back.remove();setVisibleConversation(null);};
  },[send,abortTransfers]);
  async function transferFile(id:string,file:HybridRecordingFile|null,requestNonce:string){
    if(!file)return null;
    const source=new NativeFile(file.uri);
    let handle:ReturnType<NativeFile['open']>|undefined;
    const transfer:FileTransfer={nonce:requestNonce,offset:0,cancelled:false};
    const check=()=>{if(transfer.cancelled||!mounted.current||documentNonce.current!==requestNonce||!loaded.current)throw Error('Интерфейс записи уже закрыт.');};
    const acknowledged=(offset:number,emit:()=>void)=>new Promise<void>((resolve,reject)=>{
      check();transfer.offset=offset;transfer.resolve=resolve;transfer.reject=reject;
      transfer.timer=setTimeout(()=>{transfer.cancelled=true;reject(Error('Интерфейс не подтвердил получение записи.'));},15000);
      emit();
    });
    try{
      check();
      if(fileTransfers.current.size)throw Error('Предыдущая запись ещё передаётся.');
      const size=source.size;if(!size||size>32*1024*1024)throw Error('Недопустимый размер записи');
      handle=source.open();fileTransfers.current.set(id,transfer);
      await acknowledged(0,()=>send('file:start',{id,name:file.name,type:file.mimeType,size}));
      let offset=0;
      while(offset<size){
        check();const bytes=await handle.readBytes(Math.min(32768,size-offset));
        if(!bytes.length)throw Error('Запись прочитана не полностью.');offset+=bytes.length;
        const nextOffset=offset;
        await acknowledged(nextOffset,()=>send('file:chunk',{id,offset:nextOffset,base64:fromUint8Array(bytes)}));
      }
      check();
      send('file:end',{id});return {fileId:id};
    }finally{
      if(transfer.timer)clearTimeout(transfer.timer);fileTransfers.current.delete(id);
      try{handle?.close();}catch{}
      try{if(source.exists)source.delete();}catch{}
    }
  }
  async function handle(event:WebViewMessageEvent){
    const message=parseHybridMessage(event.nativeEvent.data,nonce,event.nativeEvent.url);
    if(!message||seen.current.has(message.id))return;
    seen.current.add(message.id);if(seen.current.size>4096)seen.current.delete(seen.current.values().next().value!);
    const {id,command}=message,p=message.payload||{};
    const requestNonce=message.nonce;
    const respond=(ok:boolean,result?:unknown,error?:string)=>{if(documentNonce.current===requestNonce)send('response',{id,ok,result,error});};
    if(command==='file:ack'||command==='file:cancel'){
      const transfer=fileTransfers.current.get(p.id as string);
      if(!transfer||transfer.nonce!==requestNonce)return;
      if(command==='file:cancel'){transfer.cancelled=true;transfer.reject?.(Error('Передача записи отменена.'));}
      else if(p.offset===transfer.offset){if(transfer.timer)clearTimeout(transfer.timer);transfer.resolve?.();transfer.resolve=undefined;transfer.reject=undefined;}
      return;
    }
    if(command!=='bridge:ready'&&!loaded.current)return;
    const category=command==='sounds:pick'||command==='files:begin'?'picker':command==='register'?'register':command==='recordVideo:open'||command==='recordVoice:start'?'capture':command==='calls:dial'?'call-dial':command==='calls:accept'?'call-answer':null;
    if(category&&busy.current.has(category)){respond(false,undefined,'Предыдущее действие ещё выполняется');return;}
    if(category)busy.current.add(category);
    const traceCall=(stage:string)=>{if(command.startsWith('calls:')&&command!=='calls:journal')void NativeModules.ConnectCallCoordinator.traceBridge(command,id,stage).catch(()=>{});};
    traceCall('START');
    try{
      let result:unknown=null;
      const v=voiceRef.current;
      if(v.phase!=='idle'&&['sounds:preview','sounds:previewBuiltin'].includes(command))throw Error('Прослушивание доступно после завершения аудиозвонка');
      if(command.startsWith('calls:')&&command!=='calls:accept'&&p.callId&&p.callId!==v.shown?.id)throw Error('Этот звонок уже завершён');
      switch(command){
        case 'calls:journal':{if(p.userId!==ownerId)throw Error('Аккаунт изменился');result=JSON.parse(await NativeModules.ConnectCallCoordinator.journal(p.userId,JSON.stringify(p)));break;}
        case 'history:catalog-retire':case 'history:catalog-read':case 'history:catalog-write':case 'history:catalog-drop':case 'history:read':case 'history:page':case 'history:chunk':case 'history:write':case 'history:drop':case 'history:wipe':case 'history:stats':case 'history:limit':{
          // Native storage verifies the locally encrypted session owner itself.
          // Do not require a network token refresh to show already cached history.
          result=JSON.parse(await NativeModules.ConnectHistory.execute(p.userId,command.slice('history:'.length),JSON.stringify(p)));break;
        }
        case 'bridge:ready':{
          loaded.current=true;
          const events=queued.current.splice(0);events.forEach(([type,data])=>send(type,data));
          const call=voiceRef.current;send('call',{phase:call.phase,callId:call.shown?.id,remoteName:call.remoteName,remoteAvatar:call.remoteAvatar,elapsed:call.elapsed,muted:call.muted,speaker:call.speaker,audioOutput:call.audioOutput,error:call.error,notice:call.notice});
          send('lifecycle',AppState.currentState);void sendSounds();break;
        }
        case 'session': {
          const session=message.payload as {access_token:string;refresh_token:string}|null;
          authQueue.current=authQueue.current.catch(()=>{}).then(async()=>{
            if(!session){await disableNativePush();await db.auth.signOut({scope:'local'});currentToken.current='';return;}
            if(currentToken.current===session.access_token)return;
            const {error}=await db.auth.setSession(session);if(error)throw error;currentToken.current=session.access_token;
          });await authQueue.current;break;
        }
        case 'register': {await authQueue.current;const {data:{session}}=await db.auth.getSession();if(!session||session.access_token!==p.token)throw Error('Сессия не подтверждена');await registerNativePushNow(session.user.id);send('push-status',{ok:true});break;}
        case 'migration:get':{
          await authQueue.current;
          const {data:{session}}=await db.auth.getSession();if(!session)throw Error('Войдите в Connect');
          const preferences=await legacyWebStorage(session.user.id);
          const wallpaper=preferences['connect-android-legacy-wallpaper'];delete preferences['connect-android-legacy-wallpaper'];
          if(wallpaper){
            const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(wallpaper);
            if(match){const temp=new NativeFile(Paths.cache,'connect-wallpaper-'+Crypto.randomUUID());temp.write(toUint8Array(match[2]));result={...await transferFile(id,{uri:temp.uri,name:'wallpaper',mimeType:match[1],durationMs:0},requestNonce),preferences};break;}
          }
          result={preferences};break;
        }
        case 'files:begin':{
          const save=await beginSave(p.name as string,p.mimeType as string);
          if(save){if(documentNonce.current!==requestNonce){await cancelSave(save);break;}saves.current.set(save,requestNonce);}result=save;break;
        }
        case 'files:chunk':case 'files:end':case 'files:cancel':{
          const save=p.id as string;if(saves.current.get(save)!==requestNonce)throw Error('Файл уже закрыт');
          if(command==='files:chunk')result=await writeChunk(save,p.data as string);
          else{result=command==='files:end'?await finishSave(save):await cancelSave(save);saves.current.delete(save);}break;
        }
        case 'preferences':await SecureStore.setItemAsync('connect-native-notifications-v1',JSON.stringify(p));break;
        case 'appearance':await NativeModules.ConnectIncomingCallModule.setAppearance(p.scene);break;
        case 'vault:seal':case 'vault:open':
          if(!ownerId)throw Error('Войдите в Connect');
          result=await NativeModules.ConnectIncomingCallModule.sealSecret(ownerId,p.name,p.value,command==='vault:open');break;
        case 'activeConversation':active.current=p.id as string;setVisibleConversation(AppState.currentState==='active'?active.current||null:null);break;
        case 'read':await rememberReadAt(p.conversationId as string,p.readAt as string);await dismissChatPush(p.conversationId as string,p.readAt as string);break;
        case 'sounds:get':await sendSounds();break;
        case 'sounds:pick':await chooseConnectSound(p.kind==='call'?'calls':'messages');await sendSounds();break;
        case 'sounds:reset':await resetConnectSound(p.kind==='call'?'calls':'messages');await sendSounds();break;
        case 'sounds:preview':await previewConnectSound(p.kind==='call'?'calls':'messages');break;
        case 'sounds:silent':await setConnectSoundSilence(p.kind==='call'?'calls':'messages',p.muted as boolean);await sendSounds();break;
        case 'sounds:previewBuiltin':await previewBuiltinSound(p.tone as BuiltinNotificationTone);break;
        case 'sounds:stop':await stopSoundPreview();break;
        case 'calls:uiReady':break;
        case 'calls:timeout':await NativeModules.ConnectCallCoordinator.traceBridge(p.command,p.requestId,'TIMEOUT');await v.cancelPending(p.requestId as string);break;
        case 'calls:dial':{
          if(!ownerId)throw Error('Войдите в Connect');
          let timer:ReturnType<typeof setTimeout>|undefined;
          try{await Promise.race([recorder.current?.cancelAll(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Не удалось остановить запись перед звонком')),3000);})]);}finally{if(timer)clearTimeout(timer);}
          await v.dial(p.conversationId as string,p.peerId as string,p.peerName as string,id);break;
        }
        case 'calls:accept':{
          if(p.callId&&v.shown?.id&&v.shown.id!==p.callId)throw Error('Этот звонок уже завершён');
          await recorder.current?.cancelAll();
          if(p.callId&&v.shown?.id!==p.callId)await v.checkIncoming(p.callId as string);
          await voiceRef.current.accept(p.callId as string|undefined);break;
        }
        case 'calls:decline':await v.finish('decline');break;
        case 'calls:end':await v.finish();break;
        case 'calls:mute':v.setMicMuted(p.muted as boolean);break;
        case 'calls:speaker':await v.setSpeakerphone(p.enabled as boolean);break;
        case 'calls:route':await v.chooseAudioOutput();break;
        case 'recordVoice:start':if(v.phase!=='idle')throw Error('Завершите аудиозвонок перед записью');if(!recorder.current)throw Error('Запись ещё не готова');await recorder.current.startVoice();break;
        case 'recordVoice:stop':if(!recorder.current)throw Error('Запись закрыта');result=await transferFile(id,await recorder.current.stopVoice(p.send!==false),requestNonce);break;
        case 'recordVoice:cancel':await recorder.current?.cancelVoice();break;
        case 'recordVideo:open':if(v.phase!=='idle')throw Error('Завершите аудиозвонок перед записью');if(!recorder.current)throw Error('Запись ещё не готова');result=await transferFile(id,await recorder.current.openVideo(),requestNonce);break;
        case 'navigation:exit':BackHandler.exitApp();break;
        case 'notification:settings':if(NativeModules.ConnectIncomingCallModule?.openCallSettings)await NativeModules.ConnectIncomingCallModule.openCallSettings();else await notifee.openNotificationSettings();break;
        case 'clipboard':await Clipboard.setStringAsync(p.text as string);break;
        case 'openExternal':await Linking.openURL(p.url as string);break;
        default:throw Error('Команда пока недоступна');
      }
      traceCall('DONE');respond(true,result);
    }catch(e){traceCall('ERROR');if(command==='register')send('push-status',{ok:false});respond(false,undefined,e instanceof Error?e.message:'Ошибка Android');}
    finally{if(category)busy.current.delete(category);}
  }
  const source=useMemo(()=>initial===undefined?null:{html:pwa.replace('<head>','<head><script>window.__CONNECT_NONCE__='+JSON.stringify(nonce)+';window.__CONNECT_INITIAL_SESSION__='+JSON.stringify(initial)+';</script>'),baseUrl:CONNECT_ORIGIN+'/'},[initial,nonce]);
  const injected=useMemo(()=>`window.__CONNECT_NONCE__=${JSON.stringify(nonce)};window.__CONNECT_INITIAL_SESSION__=${JSON.stringify(initial||null)};true;`,[initial,nonce]);
  if(!source)return <View style={{flex:1,justifyContent:'center'}}><ActivityIndicator color="#ccd5df"/></View>;
  if(failure)return <View style={{flex:1,justifyContent:'center',padding:24,gap:16}}><Text style={{color:'#fff'}}>{failure}</Text><Pressable onPress={()=>{loaded.current=false;seen.current.clear();queued.current=[];abortTransfers();setFailure('');setRevision(r=>r+1);}}><Text style={{color:'#cfd8e1'}}>Повторить</Text></Pressable></View>;
  return <><ConnectHybridRecorder ref={recorder} onLevel={level=>send('record-level',level)} onRecordingChange={(recording,kind)=>send('record-state',{recording,kind})}/><WebView ref={web} key={revision} source={source} style={{flex:1,backgroundColor:'#080b11'}}
    originWhitelist={[CONNECT_ORIGIN]} injectedJavaScriptBeforeContentLoaded={injected}
    javaScriptEnabled domStorageEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never" setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
    webviewDebuggingEnabled={false} geolocationEnabled={false} allowsProtectedMedia={false}
    // Android does not call this callback for the initial source HTML load.
    // Every subsequent document is blocked, including same-origin pages: a
    // network page must never inherit the injected native nonce.
    onShouldStartLoadWithRequest={r=>{if(loaded.current&&r.isTopFrame&&/^https?:\/\//.test(r.url))void Linking.openURL(r.url).catch(()=>{});return false;}}
    onMessage={e=>{void handle(e);}}
    onError={()=>{loaded.current=false;abortTransfers();setFailure('Не удалось открыть интерфейс Connect. Повторите запуск.');}}
    onRenderProcessGone={()=>{loaded.current=false;abortTransfers();setFailure('Android освободил память интерфейса. Откройте Connect снова.');}}
  /></>;
}
export default function App(){return <SafeAreaProvider><SafeAreaView edges={['top','bottom','left','right']} style={{flex:1,backgroundColor:'#080b11'}}><StatusBar style="light"/><HybridConnect/></SafeAreaView></SafeAreaProvider>;}
