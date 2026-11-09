import React, {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,Image,Pressable,ScrollView,Text,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg,{Defs,LinearGradient,Rect,Stop} from 'react-native-svg';
import {glassColor} from './ConnectNativeGlass';
import {mediaDevices,RTCPeerConnection,RTCSessionDescription,RTCIceCandidate} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep from 'react-native-callkeep';
import {showIncomingSystemCall,showOutgoingSystemCall,answerSystemCall,activeSystemCall,endSystemCall} from './ConnectNativeTelecom';
import {db} from './backend';
import type {Profile} from './backend';
import type {Palette} from './theme';

/** The same signaling contract as the web ConnectAudioCalls controller.
 * Android's audio is native WebRTC + Android audio routing; never an HTML audio element.
 */
type CallPhase='idle'|'preparing'|'ringing'|'incoming'|'connecting'|'active';
type CallRow={id:string;conversation_id:string;caller_id:string;callee_id:string;
  status:'ringing'|'active'|'ended'|'declined'|'missed'|'failed'|'busy';
  offer:{type:'offer';sdp:string};answer:{type:'answer';sdp:string}|null;
  created_at:string;answered_at:string|null;ended_at:string|null};
type IceRow={id:number;call_id:string;sender_id:string;candidate:{candidate:string;sdpMid?:string|null;sdpMLineIndex?:number|null}};
const CALL_SELECT='id,conversation_id,caller_id,callee_id,status,offer,answer,created_at,answered_at,ended_at';
const FALLBACK_ICE=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
const RING_MS=60000;
// Audio output is managed by Android Telecom; do not hard-force the earpiece
// while a Bluetooth or wired headset might be available.
type RouteInfo = {name:string;type:string;selected?:boolean};
function routeTitle(route:RouteInfo):string{
  const kind=route.type.toLowerCase();
  if(kind.includes('bluetooth'))return 'Bluetooth';
  if(kind.includes('headset')||kind.includes('wired'))return 'Проводная гарнитура';
  if(kind.includes('speaker'))return 'Динамик';
  return 'Телефон';
}
async function readCallRoutes():Promise<RouteInfo[]>{
  try{
    // CallKeep 4.6.1 runtime returns AudioRoute[], while its declarations
    // still incorrectly type getAudioRoutes() as void.
    const value=await RNCallKeep.getAudioRoutes() as unknown;
    if(!Array.isArray(value))return [];
    return value.filter((r):r is RouteInfo=>Boolean(r)&&typeof r==='object'&&typeof r.name==='string'&&typeof r.type==='string');
  }catch(e){console.warn('Connect available audio outputs:',e);return [];}
}
const isLive=(s:string)=>s==='ringing'||s==='active';
const errText=(e:unknown)=>e instanceof Error?e.message:String(e);
const serverUrl=(path:string)=>`${(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'')}${path}`;

async function authorized(path:string,body?:object){
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw new Error('Сессия истекла. Войдите снова.');
  const response=await fetch(serverUrl(path),{
    method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  if(!response.ok)throw new Error(`Сервер звонков: HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

export function useConnectNativeVoice(userId:string,profiles:Profile[],avatars:Record<string,string>={}){
  const [phase,setPhase]=useState<CallPhase>('idle');
  const [shown,setShown]=useState<CallRow|null>(null);
  const [remoteName,setRemoteName]=useState('Собеседник');
  const [remoteId,setRemoteId]=useState('');
  const [notice,setNotice]=useState('');
  const [muted,setMuted]=useState(false);
  const [speaker,setSpeaker]=useState(false);
  const [audioOutput,setAudioOutput]=useState('Автоматически');
  const [error,setError]=useState('');
  const [elapsed,setElapsed]=useState(0);
  const call=useRef<CallRow|null>(null);
  const pc=useRef<RTCPeerConnection|null>(null);
  const mic=useRef<Awaited<ReturnType<typeof mediaDevices.getUserMedia>>|null>(null);
  const generation=useRef(0);
  const iceSent=useRef<Array<{candidate:string;sdpMid?:string|null;sdpMLineIndex?:number|null}>>([]);
  const icePending=useRef<Array<IceRow['candidate']>>([]);
  const knownIce=useRef<Set<number>>(new Set());
  const fetching=useRef(false);
  const statusFetching=useRef(false);
  const accepting=useRef(false);
  const preparing=useRef(false);
  const answerApplying=useRef(false);
  const localFlushing=useRef<number|null>(null);
  const micMutedRef=useRef(false);
  const routeBusy=useRef(false);
  const preferredRoute=useRef('');
  const manualRoute=useRef(false);
  const profilesRef=useRef(profiles);
  useEffect(()=>{profilesRef.current=profiles;},[profiles]);

  const release=useCallback(()=>{
    const nativeId=call.current?.id;
    if(nativeId)void endSystemCall(nativeId);
    generation.current++;
    try{pc.current?.close();}catch{}
    pc.current=null;
    mic.current?.getTracks().forEach(t=>t.stop());mic.current=null;
    try{InCallManager.stopRingback();}catch{}
    try{InCallManager.stopRingtone();}catch{}
    try{InCallManager.stop();}catch{}
    call.current=null;iceSent.current=[];icePending.current=[];knownIce.current=new Set();
    fetching.current=false;statusFetching.current=false;accepting.current=false;
    preparing.current=false;answerApplying.current=false;localFlushing.current=null;
    micMutedRef.current=false;routeBusy.current=false;preferredRoute.current='';manualRoute.current=false;
    setAudioOutput('Автоматически');
    setPhase('idle');setShown(null);setMuted(false);setSpeaker(false);setElapsed(0);
  },[]);

  const finish=useCallback(async(reason:'hangup'|'decline'|'missed'|'failed'|'busy'='hangup')=>{
    const row=call.current;
    release();
    if(!row)return;
    try{await db.rpc('connect_finish_audio_call',{p_call_id:row.id,p_reason:reason});}
    catch{}
    try{await authorized('/api/push/call/end',{callId:row.id});}catch{}
  },[release]);

  const remoteIce=useCallback(async()=>{
    const row=call.current,peer=pc.current;
    if(!row||!peer||fetching.current)return;
    fetching.current=true;
    try{
      const {data,error:readError}=await db.from('connect_call_ice').select('id,call_id,sender_id,candidate')
        .eq('call_id',row.id).order('id',{ascending:true}).limit(250);
      if(readError||!data||call.current?.id!==row.id)return;
      for(const item of data as IceRow[]){
        if(item.sender_id===userId||knownIce.current.has(item.id))continue;
        knownIce.current.add(item.id);
        if(!peer.remoteDescription){icePending.current.push(item.candidate);continue;}
        try{await peer.addIceCandidate(new RTCIceCandidate(item.candidate));}catch{}
      }
    }finally{fetching.current=false;}
  },[userId]);
  const flushRemote=useCallback(async()=>{
    const peer=pc.current,op=generation.current;
    if(!peer?.remoteDescription)return;
    for(const candidate of icePending.current.splice(0)){
      if(op!==generation.current||pc.current!==peer)return;
      try{await peer.addIceCandidate(new RTCIceCandidate(candidate));}catch{}
    }
  },[]);
  const flushLocal=useCallback(async()=>{
    const row=call.current,op=generation.current;
    if(!row||localFlushing.current===op)return;
    localFlushing.current=op;
    // Keep candidates in the queue until the server acknowledges each one.
    // A transient failure must not discard the rest of the batch.
    try{
      while(iceSent.current.length&&call.current?.id===row.id&&op===generation.current){
        const candidate=iceSent.current[0];
        const {error:iceError}=await db.from('connect_call_ice').insert({call_id:row.id,sender_id:userId,candidate});
        if(op!==generation.current||call.current?.id!==row.id)return;
        if(iceError)break;
        iceSent.current.shift();
      }
    }catch{/* The next sync retries the retained queue. */}
    finally{if(localFlushing.current===op)localFlushing.current=null;}
  },[userId]);

  const createPeer=useCallback(async(op:number)=>{
    // Native Android controls runtime permission. Only request a microphone on
    // user action (outgoing / accept), not when the phone receives an FCM push.
    const audio=await mediaDevices.getUserMedia({audio:true,video:false});
    if(op!==generation.current){audio.getTracks().forEach(track=>track.stop());throw new Error('Звонок отменён');}
    mic.current=audio;
    let servers=FALLBACK_ICE;
    try{
      const response=await authorized('/api/calls/ice') as {iceServers?:typeof FALLBACK_ICE};
      if(response.iceServers?.length)servers=response.iceServers;
    }catch{}
    if(op!==generation.current){audio.getTracks().forEach(track=>track.stop());throw new Error('Звонок отменён');}
    const peer=new RTCPeerConnection({iceServers:servers,bundlePolicy:'max-bundle'});
    pc.current=peer;
    audio.getAudioTracks().forEach(track=>{
      track.enabled=!micMutedRef.current;
      peer.addTrack(track,audio);
    });
    peer.addEventListener('icecandidate',event=>{
      if(pc.current!==peer||op!==generation.current)return;
      const candidate=event.candidate;
      if(!candidate)return;
      const value=candidate.toJSON();
      if(!value.candidate)return;
      iceSent.current.push({candidate:value.candidate,sdpMid:value.sdpMid,sdpMLineIndex:value.sdpMLineIndex});
      void flushLocal();
    });
    peer.addEventListener('connectionstatechange',()=>{
      if(pc.current!==peer)return;
      if(peer.connectionState==='connected'){
        if(call.current?.id)void activeSystemCall(call.current.id);
        setPhase('active');setError('');
        try{InCallManager.stopRingback();}catch{}
      }
      if(peer.connectionState==='failed'){
        setNotice('Соединение не установлено. Проверьте сеть или TURN-сервер.');
        void finish('failed');
      }
    });
    // MODE_IN_COMMUNICATION selects Android's voice-call volume stream;
    // automatic routing preserves Bluetooth / wired headset priorities.
    try{InCallManager.start({media:'audio',auto:true});}catch(e){console.warn('Connect audio session:',e);}
    return peer;
  },[finish,flushLocal]);

  const updated=useCallback(async(row:CallRow)=>{
    const current=call.current;
    if(!current||current.id!==row.id)return;
    call.current=row;setShown(row);
    if(!isLive(row.status)){
      if(row.status==='declined')setNotice('Звонок отклонён');
      else if(row.status==='busy')setNotice('Собеседник занят');
      else if(row.status==='missed')setNotice(row.caller_id===userId?'Нет ответа':`Пропущенный звонок: ${profilesRef.current.find(p=>p.id===row.caller_id)?.display_name||'Собеседник'}`);
      else if(row.status==='failed')setNotice('Соединение не установлено');
      release();return;
    }
    const peer=pc.current,op=generation.current;
    if(row.status==='active'&&row.caller_id===userId&&row.answer&&peer&&!peer.remoteDescription&&!answerApplying.current){
      answerApplying.current=true;
      try{
        await peer.setRemoteDescription(new RTCSessionDescription(row.answer));
        if(op!==generation.current||pc.current!==peer)return;
        await flushRemote();await remoteIce();
        if(op===generation.current&&peer.connectionState!=='connected')setPhase('connecting');
      }catch(e){if(op===generation.current){setNotice('Ошибка ответа WebRTC: '+errText(e));await finish('failed');}}
      finally{if(op===generation.current)answerApplying.current=false;}
    }
  },[finish,flushRemote,release,remoteIce,userId]);

  const presentIncoming=useCallback((row:CallRow)=>{
    if(call.current||preparing.current||row.callee_id!==userId||row.status!=='ringing')return;
    if(Date.now()-Date.parse(row.created_at)>RING_MS-1000)return;
    call.current=row;setShown(row);
    setRemoteName(profilesRef.current.find(p=>p.id===row.caller_id)?.display_name||'Собеседник');
    setRemoteId(row.caller_id);setNotice('');
    setPhase('incoming');setError('');
    void showIncomingSystemCall(row.id,profilesRef.current.find(p=>p.id===row.caller_id)?.display_name||'Собеседник',row.conversation_id);
  },[userId]);

  const checkIncoming=useCallback(async(callId?:string)=>{
    if(!userId)return;
    if(callId){
      const {data}=await db.from('connect_calls').select(CALL_SELECT).eq('id',callId)
        .eq('callee_id',userId).maybeSingle();
      if(data)presentIncoming(data as CallRow);
      return;
    }
    if(call.current)return;
    const {data}=await db.from('connect_calls').select(CALL_SELECT)
      .eq('callee_id',userId).eq('status','ringing')
      .gte('created_at',new Date(Date.now()-59000).toISOString())
      .order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(data)presentIncoming(data as CallRow);
  },[presentIncoming,userId]);

  const dial=useCallback(async(conversationId:string,peerId:string,peerName:string)=>{
    if(!userId||call.current||preparing.current||phase!=='idle')return;
    preparing.current=true;
    const op=++generation.current;
    setRemoteName(peerName);setRemoteId(peerId);setNotice('');setError('');setPhase('preparing');
    try{
      const peer=await createPeer(op);
      if(op!==generation.current)return;
      const offer=await peer.createOffer();
      if(op!==generation.current)return;
      await peer.setLocalDescription(offer);
      if(op!==generation.current)return;
      const local=peer.localDescription;
      if(!local?.sdp)throw new Error('WebRTC не создал предложение соединения');
      const {data,error:rpcError}=await db.rpc('connect_start_audio_call',{
        p_conversation_id:conversationId,p_offer:{type:'offer',sdp:local.sdp},
      });
      if(rpcError||!data)throw new Error(rpcError?.message||'Сервер отклонил звонок');
      if(op!==generation.current){await db.rpc('connect_finish_audio_call',{p_call_id:data.id,p_reason:'hangup'});return;}
      preparing.current=false;
      call.current=data as CallRow;setShown(data as CallRow);setPhase('ringing');
      void showOutgoingSystemCall(data.id,peerName);
      try{InCallManager.startRingback('_DEFAULT_');}catch{}
      void authorized('/api/push/call',{callId:data.id}).catch(()=>{});
      await flushLocal();await remoteIce();
    }catch(e){if(op===generation.current){setNotice('Не удалось позвонить: '+errText(e));release();}}
  },[createPeer,flushLocal,phase,release,remoteIce,userId]);

  const accept=useCallback(async(expectedCallId?:string)=>{
    const row=call.current;
    if(!row||(expectedCallId&&row.id!==expectedCallId)||row.callee_id!==userId||row.status!=='ringing'||accepting.current)return;
    accepting.current=true;
    void answerSystemCall(row.id);
    const op=generation.current;
    setPhase('connecting');setError('');
    try{
      const peer=await createPeer(op);
      if(op!==generation.current||call.current?.id!==row.id)return;
      await peer.setRemoteDescription(new RTCSessionDescription(row.offer));
      if(op!==generation.current)return;
      await flushRemote();await remoteIce();
      if(op!==generation.current)return;
      const answer=await peer.createAnswer();
      if(op!==generation.current)return;
      await peer.setLocalDescription(answer);
      if(op!==generation.current)return;
      const local=peer.localDescription;
      if(!local?.sdp)throw new Error('WebRTC не создал ответ соединения');
      const {data,error:rpcError}=await db.rpc('connect_answer_audio_call',{
        p_call_id:row.id,p_answer:{type:'answer',sdp:local.sdp},
      });
      if(rpcError||!data)throw new Error(rpcError?.message||'Вызов уже завершился');
      if(op!==generation.current)return;
      call.current=data as CallRow;setShown(data as CallRow);
      await flushLocal();await remoteIce();
    }catch(e){if(op===generation.current){setNotice('Не удалось принять звонок: '+errText(e));await finish('failed');}}
    finally{if(op===generation.current)accepting.current=false;}
  },[createPeer,finish,flushLocal,flushRemote,remoteIce,userId]);

  const setMicMuted=useCallback((next:boolean)=>{
    micMutedRef.current=next;
    mic.current?.getAudioTracks().forEach(track=>{track.enabled=!next;});
    setMuted(next);
  },[]);
  const toggleMute=useCallback(()=>setMicMuted(!micMutedRef.current),[setMicMuted]);

  const applyAudioOutput=useCallback(async(output:RouteInfo,manual:boolean)=>{
    const callId=call.current?.id;
    if(!callId||routeBusy.current)return;
    routeBusy.current=true;
    try{
      // Some Android/CallKeep versions leave this promise pending when Telecom
      // has not finished creating the connection. Never wedge route polling.
      await Promise.race([
        RNCallKeep.setAudioRoute(callId,output.name),
        new Promise<void>((_resolve,reject)=>setTimeout(()=>reject(new Error('Audio route timed out')),1800)),
      ]);
      if(call.current?.id!==callId)return;
      manualRoute.current=manual;
      preferredRoute.current=output.name;
      setAudioOutput(routeTitle(output));
      setSpeaker(output.type.toLowerCase().includes('speaker'));
    }catch(e){console.warn('Connect audio output switching:',e);}
    finally{routeBusy.current=false;}
  },[]);

  const refreshAudioOutputs=useCallback(async()=>{
    const callId=call.current?.id;
    if(!callId||routeBusy.current)return;
    const routes=await readCallRoutes();
    if(call.current?.id!==callId||!routes.length)return;
    if(manualRoute.current){
      if(routes.some(r=>r.name===preferredRoute.current))return;
      // A manually selected headset was disconnected: return to automatic.
      manualRoute.current=false;preferredRoute.current='';
    }
    const chosen=routes.find(r=>r.type.toLowerCase().includes('bluetooth'))
      ||routes.find(r=>/headset|wired/.test(r.type.toLowerCase()))
      ||routes.find(r=>r.selected)
      ||routes.find(r=>/phone|earpiece/.test(r.type.toLowerCase()))
      ||routes[0];
    if(chosen.name!==preferredRoute.current)void applyAudioOutput(chosen,false);
  },[applyAudioOutput]);

  const chooseAudioOutput=useCallback(async()=>{
    const routes=await readCallRoutes();
    if(!call.current?.id||!routes.length){
      Alert.alert('Аудиовыход','Подключите разговор и повторите попытку.');return;
    }
    // Native Android Alert supports at most three action buttons. Show the
    // headset (Bluetooth preferred), speaker and phone. Closing the dialog
    // does not alter the current route. Automatic choice remains the default.
    const external=routes.find(r=>r.type.toLowerCase().includes('bluetooth'))
      ||routes.find(r=>/wired|headset/.test(r.type.toLowerCase()));
    const outputSpeaker=routes.find(r=>r.type.toLowerCase().includes('speaker'));
    const handset=routes.find(r=>/phone|earpiece/.test(r.type.toLowerCase()));
    const buttons=[external,outputSpeaker,handset].filter((r):r is RouteInfo=>Boolean(r))
      .slice(0,3).map(r=>({text:routeTitle(r),onPress:()=>{void applyAudioOutput(r,true);}}));
    if(buttons.length<3)buttons.push({text:'Отмена',onPress:()=>{}});
    Alert.alert('Вывод звука','Выберите устройство для разговора',buttons,{cancelable:true});
  },[applyAudioOutput,refreshAudioOutputs]);

  useEffect(()=>{
    if(phase!=='active'||!shown?.id)return;
    void refreshAudioOutputs();
    // Poll available devices: Android changes output lists when a Bluetooth
    // headset is connected or disconnected during a call.
    const timer=setInterval(()=>{void refreshAudioOutputs();},2800);
    const subscription=RNCallKeep.addEventListener('didChangeAudioRoute',event=>{
      if(event.callUUID!==shown.id)return;
      const output=(event.output||'').toLowerCase();
      setSpeaker(output.includes('speaker'));
      if(output.includes('bluetooth'))setAudioOutput('Bluetooth');
      else if(output.includes('speaker'))setAudioOutput('Динамик');
      else if(output.includes('headset')||output.includes('wired'))setAudioOutput('Проводная гарнитура');
      else if(output)setAudioOutput('Телефон');
    });
    return()=>{clearInterval(timer);subscription.remove();};
  },[phase,shown?.id,refreshAudioOutputs]);

  useEffect(()=>{
    if(!userId){release();return;}
    let live=true;
    void checkIncoming();
    const timer=setInterval(()=>{if(live)void checkIncoming();},2500);
    const channel=db.channel(`connect-native-incoming-${userId}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'connect_calls',filter:`callee_id=eq.${userId}`},()=>{if(live)void checkIncoming();})
      .subscribe(status=>{if(live&&status==='SUBSCRIBED')void checkIncoming();});
    const appState=AppState.addEventListener('change',state=>{if(live&&state==='active')void checkIncoming();});
    return()=>{live=false;clearInterval(timer);appState.remove();void db.removeChannel(channel);release();};
  },[checkIncoming,userId,release]);
  useEffect(()=>{
    const id=shown?.id;
    if(!id)return;
    let live=true;
    const resync=async()=>{
      const {data}=await db.from('connect_calls').select(CALL_SELECT).eq('id',id).maybeSingle();
      if(live&&data)await updated(data as CallRow);
      if(live){await remoteIce();await flushLocal();}
    };
    // Realtime gives prompt answer/end/ICE propagation. Polling below remains
    // authoritative when a socket is unavailable or resumes after a gap.
    const channel=db.channel(`connect-native-active-call-${id}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'connect_calls',filter:`id=eq.${id}`},()=>{if(live)void resync();})
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'connect_call_ice',filter:`call_id=eq.${id}`},()=>{if(live)void remoteIce();})
      .subscribe(status=>{if(live&&status==='SUBSCRIBED')void resync();});
    const appState=AppState.addEventListener('change',state=>{if(live&&state==='active')void resync();});
    return()=>{live=false;appState.remove();void db.removeChannel(channel);};
  },[shown?.id,updated,remoteIce,flushLocal]);
  useEffect(()=>{
    if(!shown?.id)return;
    const timer=setInterval(()=>{
      const row=call.current;
      if(!row)return;
      if(row.status==='ringing'&&Date.now()-Date.parse(row.created_at)>RING_MS){
        setNotice(row.caller_id===userId?'Нет ответа':`Пропущенный звонок: ${profilesRef.current.find(p=>p.id===row.caller_id)?.display_name||'Собеседник'}`);
        if(row.caller_id===userId)void finish('missed');else release();
        return;
      }
      if(!statusFetching.current){
        statusFetching.current=true;
        void Promise.resolve(
          db.from('connect_calls').select(CALL_SELECT).eq('id',row.id).maybeSingle()
            .then(({data})=>{if(data)void updated(data as CallRow);})
        ).finally(()=>{statusFetching.current=false;}).catch(()=>{});
      }
      if(pc.current){void remoteIce();void flushLocal();}
    },1400);
    return()=>clearInterval(timer);
  },[shown?.id,finish,flushLocal,release,remoteIce,updated,userId]);
  useEffect(()=>{
    if(phase!=='active'||!shown?.answered_at)return;
    const tick=()=>setElapsed(Math.max(0,Math.floor((Date.now()-Date.parse(shown.answered_at!))/1000)));
    tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
  },[phase,shown?.answered_at]);

  return {phase,shown,remoteName,remoteAvatar:avatars[remoteId]||'',notice,dismissNotice:()=>setNotice(''),error,muted,speaker,audioOutput,elapsed,dial,accept,finish,toggleMute,setMicMuted,chooseAudioOutput,checkIncoming};
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
    incoming:'Входящий аудиозвонок',connecting:'Соединяем…',active:`Разговор · ${duration}`};
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
