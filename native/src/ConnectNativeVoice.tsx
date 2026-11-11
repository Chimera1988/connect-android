import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,DeviceEventEmitter,NativeModules,Image,Pressable,ScrollView,Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg,{Defs,LinearGradient,Rect,Stop} from 'react-native-svg';
import {glassColor} from './ConnectNativeGlass';
import type {Profile} from './backend';
import type {Palette} from './theme';

type CallPhase='idle'|'preparing'|'ringing'|'incoming'|'connecting'|'active'|'reconnecting';
type CallRow={id:string;caller_id:string;callee_id:string;conversation_id:string;status:string;created_at:string;answered_at:string|null};
type NativeState={sequence?:number;phase:CallPhase;state:string;userId?:string;callId?:string;shown?:CallRow;remoteName:string;remoteAvatar:string;notice?:string;error:string;muted:boolean;speaker:boolean;audioOutput:string;elapsed:number};
const native=NativeModules.ConnectCallCoordinator;
const initial:NativeState={phase:'idle',state:'IDLE',remoteName:'Собеседник',remoteAvatar:'',notice:'',error:'',muted:false,speaker:false,audioOutput:'Автоматически',elapsed:0};
/** Sole call engine lives in Kotlin; losing React/WebView does not end a call. */
export function useConnectNativeVoice(userId:string,_profiles:Profile[],_avatars:Record<string,string>={}){
  const [state,setState]=useState<NativeState>(initial),[notice,setNotice]=useState('');
  const latest=useRef(state);latest.current=state;
  const bridgeRequest=useRef('');
  const starting=useRef(false),operation=useRef(0),pendingId=useRef(''),lastSequence=useRef(-1),lastNotice=useRef(-1);
  useEffect(()=>{
    operation.current++;starting.current=false;pendingId.current='';latest.current=initial;setState(initial);
    if(!userId)return;
    let live=true;lastSequence.current=-1;
    const update=(value:NativeState)=>{if(!live||value.userId&&value.userId!==userId||(value.sequence??0)<lastSequence.current)return;lastSequence.current=value.sequence??0;setState(previous=>previous.sequence===value.sequence&&previous.elapsed===value.elapsed&&previous.phase===value.phase?previous:{...initial,...value});if(value.phase==='idle'&&!starting.current&&value.state!=='IDLE')pendingId.current='';if(value.notice&&(value.sequence??0)>lastNotice.current){lastNotice.current=value.sequence??0;setNotice(value.notice);}};
    const refresh=()=>{void native.getState().then(update).catch(()=>{});};
    const event=DeviceEventEmitter.addListener('connect:call-state',update);
    const resumes=AppState.addEventListener('change',v=>{if(v==='active')refresh();});
    refresh();const timer=setInterval(()=>{if(latest.current.phase!=='idle'&&AppState.currentState==='active')refresh();},1000);
    return()=>{live=false;operation.current++;starting.current=false;event.remove();resumes.remove();clearInterval(timer);};
  },[userId]);
  const control=useCallback(async(action:string,id?:string)=>{const current=id||latest.current.callId||pendingId.current;if(current)await native.control(current,action);},[]);
  const dial=useCallback(async(conversationId:string,peerId:string,peerName:string,requestId?:string)=>{
    if(latest.current.phase!=='idle'||!userId||starting.current)return;
    starting.current=true;const token=++operation.current;pendingId.current=Crypto.randomUUID();bridgeRequest.current=requestId||pendingId.current;setNotice('');
    try{const allowed=await NativeModules.ConnectIncomingCallModule.requestMicrophone();if(token!==operation.current)return;if(!allowed)throw Error('Для аудиозвонка нужен доступ к микрофону');await native.dial(conversationId,peerId,peerName,pendingId.current);}
    catch(e){if(token===operation.current){setNotice(e instanceof Error?e.message:'Не удалось начать вызов');throw e;}}finally{if(token===operation.current)starting.current=false;}
  },[userId]);
  const cancelPending=useCallback(async(requestId:string)=>{
    if(bridgeRequest.current!==requestId||!starting.current)return;
    const current=await native.getState();
    if(bridgeRequest.current!==requestId||!starting.current||!['idle','preparing'].includes(current.phase))return;
    operation.current++;starting.current=false;
    await NativeModules.ConnectIncomingCallModule.cancelMicrophone?.();
    if(pendingId.current)await native.control(pendingId.current,'bridge-timeout');
  },[]);
  const accept=useCallback(async(id?:string)=>{await control('answer',id);},[control]);
  const finish=useCallback(async(reason='hangup')=>{operation.current++;starting.current=false;await control(reason==='decline'?'decline':'end');},[control]);
  const checkIncoming=useCallback(async(id?:string)=>{if(id)await native.incoming(id);},[]);
  const toggleMute=useCallback(()=>{void control('mute');},[control]);
  const setMicMuted=useCallback((next:boolean)=>{if(next!==latest.current.muted)void control('mute');},[control]);
  const setSpeakerphone=useCallback(async(next:boolean)=>{if(next!==latest.current.speaker)await control('speaker');},[control]);
  const chooseAudioOutput=useCallback(async()=>{await native.chooseRoute();},[]);
  return {...state,shown:state.shown||null,notice,dismissNotice:()=>setNotice(''),dial,cancelPending,accept,finish,checkIncoming,toggleMute,setMicMuted,setSpeakerphone,chooseAudioOutput};
}

export type VoiceController=ReturnType<typeof useConnectNativeVoice>;

export function ConnectNativeVoicePanel({voice,colors}:{voice:VoiceController;colors:Palette}){
  if(voice.phase==='idle')return voice.notice?<Pressable accessibilityRole="button" accessibilityLabel="Закрыть уведомление о звонке" onPress={voice.dismissNotice}
    style={{position:'absolute',left:16,right:16,bottom:90,padding:16,borderRadius:18,borderColor:colors.line,borderWidth:1,backgroundColor:colors.elevated}}>
    <Text accessibilityLiveRegion="polite" style={{color:colors.text,textAlign:'center'}}>{voice.notice} · Закрыть</Text>
  </Pressable>:null;
  const iconBtn=(icon:keyof typeof Ionicons.glyphMap,label:string,action:()=>void,background:string,disabled=false)=>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} onPress={action} disabled={disabled}
      style={{width:70,alignItems:'center',gap:8,opacity:disabled?.4:1}}>
      <View style={{width:58,height:58,backgroundColor:background,borderRadius:23,alignItems:'center',justifyContent:'center',borderColor:'rgba(255,255,255,.14)',borderWidth:1}}>
        <Ionicons name={icon} size={25} color="#fff" style={background==='#df3e57'?{transform:[{rotate:'135deg'}]}:undefined}/>
      </View>
      <Text style={{fontSize:12,lineHeight:16,color:colors.text,textAlign:'center'}}>{label}</Text>
    </Pressable>;
  const duration=`${Math.floor(voice.elapsed/60)}:${String(voice.elapsed%60).padStart(2,'0')}`;
  const caption:Record<CallPhase,string>={idle:'',preparing:'Подключаем микрофон…',ringing:'Вызываем…',
    incoming:'Входящий аудиозвонок',connecting:'Соединяем…',reconnecting:'Восстановление соединения…',active:`Разговор · ${duration}`};
  const incoming=voice.phase==='incoming';
  return <View accessibilityViewIsModal style={{position:'absolute',top:0,bottom:0,left:0,right:0,
    backgroundColor:'rgba(1,5,13,.76)',paddingVertical:18,paddingHorizontal:16,alignItems:'center',justifyContent:'center'}}>
    <ScrollView style={{width:'100%',maxWidth:410,flexGrow:0,borderRadius:30,borderWidth:1,borderColor:'rgba(224,247,255,.21)',
      backgroundColor:colors.surface,elevation:24}} contentContainerStyle={{paddingTop:32,paddingHorizontal:20,paddingBottom:25,alignItems:'center'}}>
      <Svg pointerEvents="none" width="100%" height="100%" style={{position:'absolute',top:0,left:0}}>
        <Defs><LinearGradient id="connect-call-card" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.elevated} stopOpacity=".98"/><Stop offset="1" stopColor={colors.bg} stopOpacity=".97"/>
        </LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#connect-call-card)"/>
      </Svg>
      <Text style={{color:colors.muted,fontSize:13,letterSpacing:.4,marginBottom:22}}>CONNECT · АУДИО</Text>
      <View style={{width:100,height:100,borderRadius:50,borderColor:glassColor(colors.accent,.84),borderWidth:3,overflow:'hidden',marginBottom:17,
        backgroundColor:colors.elevated,alignItems:'center',justifyContent:'center'}}>
        {voice.remoteAvatar?<Image source={{uri:voice.remoteAvatar}} style={{width:100,height:100}}/>:<Text style={{color:colors.accent,fontWeight:'700',fontSize:40}}>{voice.remoteName.trim().slice(0,1).toLocaleUpperCase('ru-RU')}</Text>}
      </View>
      <Text style={{fontSize:25,fontWeight:'700',color:colors.text,textAlign:'center',marginBottom:6}}>{voice.remoteName}</Text>
      <Text accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:14,textAlign:'center',minHeight:20,marginBottom:30}}>{caption[voice.phase]}</Text>
      {(voice.phase==='preparing'||voice.phase==='connecting')&&<ActivityIndicator color={colors.accent} style={{marginBottom:18}}/>}
      <View style={{flexDirection:'row',justifyContent:'center',alignItems:'flex-start',gap:19,flexWrap:'wrap',width:'100%'}}>
        {incoming?<>
          {iconBtn('call','Принять',()=>void voice.accept(),'#17aa76')}
          {iconBtn('call','Отклонить',()=>void voice.finish('decline'),'#df3e57')}
        </>:<>
          {(voice.phase==='active'||voice.phase==='connecting')&&iconBtn(voice.muted?'mic-off':'mic',voice.muted?'Включить микрофон':'Выключить микрофон',voice.toggleMute,voice.muted?'rgba(202,57,85,.24)':'rgba(99,135,173,.19)')}
          {iconBtn(voice.speaker?'volume-high':'volume-medium','Вывод звука',voice.chooseAudioOutput,'rgba(99,135,173,.19)',!voice.shown)}
          {iconBtn('call','Завершить',()=>void voice.finish(),'#df3e57')}
        </>}
      </View>
      {!!voice.error&&<Text accessibilityRole="alert" style={{color:colors.danger,textAlign:'center',marginTop:18,fontSize:12}}>{voice.error}</Text>}
      {!incoming&&voice.phase!=='preparing'&&<Text style={{color:colors.muted,fontSize:11,lineHeight:17,textAlign:'center',marginTop:22}}>{voice.audioOutput}</Text>}
    </ScrollView>
  </View>;
}
