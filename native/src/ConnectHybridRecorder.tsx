/** Native microphone/camera capture for the bundled PWA. Files are finalized
 * before returning them to the host; the host owns successful result files.
 */
import React,{forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Linking,Modal,Pressable,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AudioModule,RecordingPresets,setAudioModeAsync,useAudioRecorder} from 'expo-audio';
import {CameraView,useCameraPermissions,useMicrophonePermissions} from 'expo-camera';
import {File} from 'expo-file-system';
import {useVideoPlayer,VideoView} from 'expo-video';

export type HybridRecordingFile={uri:string;name:string;mimeType:string;durationMs:number};
export type ConnectHybridRecorderHandle={
  startVoice:()=>Promise<void>;
  stopVoice:(send?:boolean)=>Promise<HybridRecordingFile|null>;
  cancelVoice:()=>Promise<void>;
  openVideo:()=>Promise<HybridRecordingFile|null>;
  cancelAll:()=>Promise<void>;
};
type Props={
  onResult?:(file:HybridRecordingFile|null,kind:'voice'|'video')=>void;
  onRecordingChange?:(active:boolean,kind:'voice'|'video')=>void;
  onLevel?:(level:number)=>void;
};
const MAX_VIDEO_SECONDS=60;
const MAX_VIDEO_BYTES=18*1024*1024;
const MAX_VOICE_BYTES=32*1024*1024;
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
function removeFile(uri:string|null|undefined){
  if(!uri)return;
  try{const file=new File(uri);if(file.exists)file.delete();}catch{/* Best-effort cache cleanup. */}
}

function Preview({uri,size}:{uri:string;size:number}){
  const player=useVideoPlayer(uri,p=>{p.loop=true;});
  const [playing,setPlaying]=useState(false);
  useEffect(()=>{
    const status=player.addListener('playingChange',event=>setPlaying(event.isPlaying));
    const lifecycle=AppState.addEventListener('change',state=>{if(state!=='active')player.pause();});
    return()=>{status.remove();lifecycle.remove();try{player.pause();}catch{}};
  },[player]);
  return <Pressable accessibilityRole="button" accessibilityLabel={playing?'Пауза':'Просмотреть видеокружок'}
    onPress={()=>{if(player.playing)player.pause();else player.play();}}
    style={[styles.circle,{width:size,height:size,borderRadius:size/2}]}>
    <VideoView player={player} nativeControls={false} contentFit="cover" surfaceType="textureView" style={StyleSheet.absoluteFill}/>
    {!playing&&<View pointerEvents="none" style={styles.previewOverlay}><Text style={styles.play}>▶</Text></View>}
  </Pressable>;
}

type VideoProps={onFinish:(file:HybridRecordingFile|null)=>void;onRecording:(active:boolean)=>void};
function VideoRecorder({onFinish,onRecording}:VideoProps){
  const camera=useRef<CameraView|null>(null);
  const [cameraPermission,requestCamera]=useCameraPermissions();
  const [microphonePermission,requestMic]=useMicrophonePermissions();
  const [phase,setPhase]=useState<'ready'|'recording'|'preview'>('ready');
  const [facing,setFacing]=useState<'front'|'back'>('front');
  const [ready,setReady]=useState(false);
  const [seconds,setSeconds]=useState(0);
  const [problem,setProblem]=useState('');
  const [granting,setGranting]=useState(false);
  const [preview,setPreview]=useState<HybridRecordingFile|null>(null);
  const mounted=useRef(true),cancelled=useRef(false),recording=useRef(false);
  const ownedFile=useRef<string|null>(null);
  const began=useRef(0),duration=useRef(0);
  const permissionRequest=useRef(false);
  const {width,height}=useWindowDimensions();
  const diameter=Math.max(160,Math.min(340,width-48,height*.43));
  const allowed=Boolean(cameraPermission?.granted&&microphonePermission?.granted);
  const callbacks=useRef({onFinish,onRecording});callbacks.current={onFinish,onRecording};
  const notifyRecording=(active:boolean)=>callbacks.current.onRecording(active);
  function stop(){if(recording.current)try{camera.current?.stopRecording();}catch(e){setProblem(errorText(e));}}
  const close=useCallback(()=>{
    cancelled.current=true;
    if(recording.current)try{camera.current?.stopRecording();}catch{}
    callbacks.current.onRecording(false);
    removeFile(ownedFile.current);ownedFile.current=null;
    callbacks.current.onFinish(null);
  },[]);
  useEffect(()=>{
    mounted.current=true;
    const lifecycle=AppState.addEventListener('change',state=>{if(state==='background'&&!permissionRequest.current)close();});
    return()=>{
      mounted.current=false;cancelled.current=true;lifecycle.remove();
      if(recording.current)try{camera.current?.stopRecording();}catch{}
      callbacks.current.onRecording(false);
      removeFile(ownedFile.current);ownedFile.current=null;
    };
  },[close]);
  async function grant(){
    if(permissionRequest.current)return;
    permissionRequest.current=true;setGranting(true);setProblem('');
    try{
      const cp=cameraPermission?.granted?cameraPermission:await requestCamera();
      if(!mounted.current||cancelled.current)return;
      const mp=microphonePermission?.granted?microphonePermission:await requestMic();
      if(!mounted.current||cancelled.current)return;
      if(!cp.granted||!mp.granted)setProblem('Разрешите камеру и микрофон для записи видеокружка.');
    }catch(e){if(mounted.current)setProblem(errorText(e));}
    finally{permissionRequest.current=false;if(mounted.current)setGranting(false);}
  }
  useEffect(()=>{
    if(phase!=='recording')return;
    const timer=setInterval(()=>{
      const elapsed=Math.min(MAX_VIDEO_SECONDS,Math.floor((performance.now()-began.current)/1000));
      setSeconds(elapsed);
      if(elapsed>=MAX_VIDEO_SECONDS&&recording.current)try{camera.current?.stopRecording();}catch{}
    },250);
    return()=>clearInterval(timer);
  },[phase]);
  async function start(){
    if(!camera.current||!ready||!allowed||recording.current||phase!=='ready')return;
    recording.current=true;duration.current=0;began.current=performance.now();
    setProblem('');setSeconds(0);setPhase('recording');notifyRecording(true);
    try{
      const result=await camera.current.recordAsync({maxDuration:MAX_VIDEO_SECONDS,maxFileSize:MAX_VIDEO_BYTES,progressUpdateInterval:.25});
      recording.current=false;notifyRecording(false);
      if(!mounted.current||cancelled.current){removeFile(result?.uri);return;}
      if(!result?.uri)throw new Error('Камера не сохранила видеокружок.');
      ownedFile.current=result.uri;
      const size=new File(result.uri).size;
      if(!size||size<256||size>MAX_VIDEO_BYTES)throw new Error('Видеокружок пуст или превышает 18 МБ.');
      const durationMs=Math.min(MAX_VIDEO_SECONDS*1000,Math.max(0,Math.round(duration.current||performance.now()-began.current)));
      if(durationMs<200)throw new Error('Запись слишком короткая. Попробуйте ещё раз.');
      setPreview({uri:result.uri,name:`connect-video-note-${Date.now()}.mp4`,mimeType:'video/mp4',durationMs});
      setPhase('preview');
    }catch(e){
      recording.current=false;notifyRecording(false);
      removeFile(ownedFile.current);ownedFile.current=null;
      if(mounted.current&&!cancelled.current){setProblem('Не удалось записать видео: '+errorText(e));setPhase('ready');}
    }
  }
  function send(){
    if(!preview||phase!=='preview'||cancelled.current)return;
    // Ownership transfers to the host, which removes the file after transport.
    ownedFile.current=null;cancelled.current=true;
    callbacks.current.onFinish(preview);
  }
  const button=(label:string,onPress:()=>void,primary=false,disabled=false)=><Pressable key={label}
    accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button,primary&&styles.primary,disabled&&styles.disabled]}>
    <Text style={[styles.buttonLabel,primary&&styles.primaryLabel]}>{label}</Text>
  </Pressable>;
  return <Modal visible animationType="slide" statusBarTranslucent={false} onRequestClose={close}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}><Text style={styles.title}>Видеокружок</Text>{button('Отмена',close)}</View>
      <View style={styles.content}>
        {preview?<Preview uri={preview.uri} size={diameter}/>:<View style={[styles.circle,{width:diameter,height:diameter,borderRadius:diameter/2}]}>
          {allowed?<CameraView ref={camera} mode="video" mute={false} facing={facing} videoQuality="480p" videoBitrate={850000}
            style={StyleSheet.absoluteFill} onCameraReady={()=>setReady(true)}
            onMountError={event=>{setReady(false);setProblem('Камера: '+event.message);}}
            onRecordingProgress={event=>{duration.current=event.duration*1000;}}/>:
            <Text style={styles.permissionText}>Для видеокружка нужны камера и микрофон</Text>}
        </View>}
        <Text accessibilityLiveRegion="polite" style={styles.caption}>{phase==='recording'?`● ${seconds} / ${MAX_VIDEO_SECONDS} с`:phase==='preview'?'Предпросмотр':'Запись внутри Connect'}</Text>
        <Text style={styles.hint}>До 60 секунд · перед отправкой можно пересмотреть</Text>
        {!!problem&&<Text accessibilityRole="alert" style={styles.problem}>{problem}</Text>}
      </View>
      <View style={styles.controls}>
        {!allowed?<>
          {button('Разрешить доступ',()=>{void grant();},true,granting)}
          {(cameraPermission?.canAskAgain===false||microphonePermission?.canAskAgain===false)&&button('Настройки Android',()=>{void Linking.openSettings();})}
          {granting&&<ActivityIndicator color="#e9eef3"/>}
        </>:phase==='recording'?button('Остановить',stop,true):phase==='preview'?<>
          {button('Переснять',()=>{removeFile(ownedFile.current);ownedFile.current=null;setPreview(null);setReady(false);setSeconds(0);setPhase('ready');})}
          {button('Отправить',send,true)}
        </>:<>
          {button('Сменить камеру',()=>{setReady(false);setFacing(value=>value==='front'?'back':'front');},false,!ready)}
          {button('Записать',()=>{void start();},true,!ready)}
        </>}
      </View>
    </SafeAreaView>
  </Modal>;
}

const ConnectHybridRecorder=forwardRef<ConnectHybridRecorderHandle,Props>(function ConnectHybridRecorder(props,ref){
  // AAC in a finalized MPEG-4 container is playable by Android and the PWA.
  const recorder=useAudioRecorder({...RecordingPresets.HIGH_QUALITY,numberOfChannels:1,bitRate:96000,isMeteringEnabled:true});
  const callbacks=useRef(props);callbacks.current=props;
  const meterTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const mounted=useRef(true),generation=useRef(0),voiceActive=useRef(false),voicePrepared=useRef(false),permissionPending=useRef(false);
  const queue=useRef<Promise<unknown>>(Promise.resolve());
  const began=useRef(0);
  const [videoVisible,setVideoVisible]=useState(false);
  const videoResolver=useRef<((result:HybridRecordingFile|null)=>void)|null>(null);
  const videoOpening=useRef(false);
  function serialize<T,>(operation:()=>Promise<T>):Promise<T>{
    const result=queue.current.catch(()=>{}).then(operation);
    queue.current=result.catch(()=>{});
    return result;
  }
  const announce=useCallback((active:boolean,kind:'voice'|'video')=>{callbacks.current.onRecordingChange?.(active,kind);},[]);
  const finishVideo=useCallback((file:HybridRecordingFile|null)=>{
    const resolve=videoResolver.current;videoResolver.current=null;
    if(!resolve){if(file)removeFile(file.uri);return;}
    if(mounted.current)setVideoVisible(false);
    announce(false,'video');resolve(file);callbacks.current.onResult?.(file,'video');
  },[announce]);
  const stopVoiceInternal=useCallback(async(send:boolean):Promise<HybridRecordingFile|null>=>{
    if(!voiceActive.current&&!voicePrepared.current)return null;
    const operationGeneration=generation.current;
    const wasActive=voiceActive.current;
    const elapsed=began.current?performance.now()-began.current:0;
    let nativeDuration=0;
    try{nativeDuration=recorder.getStatus().durationMillis;}catch{}
    let result:HybridRecordingFile|null=null;
    let fileUri:string|null=null;
    try{
      // Await stop: AAC's container must be finalized before reading/sending.
      await recorder.stop();
      fileUri=recorder.uri;
      if(send&&wasActive&&operationGeneration===generation.current&&mounted.current){
        if(!fileUri)throw new Error('Аудиозапись не сохранилась.');
        const size=new File(fileUri).size;
        if(!size||size<128||size>MAX_VOICE_BYTES)throw new Error('Аудиозапись пуста или превышает 32 МБ.');
        const durationMs=Math.max(0,Math.round(nativeDuration||elapsed));
        if(durationMs<200)throw new Error('Аудиозапись слишком короткая.');
        result={uri:fileUri,name:`connect-voice-${Date.now()}.m4a`,mimeType:'audio/mp4',durationMs};
      }
      return result;
    }finally{
      if(meterTimer.current){clearInterval(meterTimer.current);meterTimer.current=null;}
      voiceActive.current=false;voicePrepared.current=false;began.current=0;
      announce(false,'voice');
      await setAudioModeAsync({allowsRecording:false}).catch(()=>{});
      if(!result)removeFile(fileUri||recorder.uri);
      callbacks.current.onResult?.(result,'voice');
    }
  },[recorder,announce]);
  const cancelVoice=useCallback(async()=>{
    // Invalidates in-flight permission/prepare operations before queueing stop.
    generation.current++;
    await serialize(async()=>{await stopVoiceInternal(false);});
  },[stopVoiceInternal]);
  const cancelAll=useCallback(async()=>{
    videoOpening.current=false;
    finishVideo(null);
    await cancelVoice();
  },[cancelVoice,finishVideo]);
  useEffect(()=>{
    mounted.current=true;
    const subscription=AppState.addEventListener('change',state=>{if(state==='background'&&!permissionPending.current&&(voiceActive.current||voicePrepared.current))void cancelVoice();});
    return()=>{
      mounted.current=false;generation.current++;subscription.remove();
      if(meterTimer.current){clearInterval(meterTimer.current);meterTimer.current=null;}
      const resolve=videoResolver.current;videoResolver.current=null;resolve?.(null);
      // expo-audio also disposes its recorder on unmount. Stop eagerly when
      // possible and restore recording mode even if disposal wins the race.
      if(voiceActive.current||voicePrepared.current)void recorder.stop().catch(()=>{}).finally(()=>{
        removeFile(recorder.uri);void setAudioModeAsync({allowsRecording:false}).catch(()=>{});
      });
      announce(false,'voice');announce(false,'video');
    };
  },[cancelAll,recorder,announce]);
  useImperativeHandle(ref,()=>({
    startVoice:()=>{
      const requestedGeneration=generation.current;
      return serialize(async()=>{
        if(voiceActive.current||videoResolver.current||videoOpening.current)throw new Error('Другая запись уже выполняется.');
        const check=()=>{
          if(!mounted.current||requestedGeneration!==generation.current)throw new Error('Запись прервана. Повторите действие.');
          if(AppState.currentState==='background')throw new Error('Для записи вернитесь в Connect.');
        };
        try{
          check();
          permissionPending.current=true;
          let permission;
          try{permission=await AudioModule.requestRecordingPermissionsAsync();}
          finally{permissionPending.current=false;}
          if(permission.granted&&AppState.currentState!=='active')await new Promise<void>((resolve,reject)=>{
            const timeout=setTimeout(()=>{subscription.remove();reject(new Error('Не удалось возобновить запись после запроса микрофона.'));},10000);
            const subscription=AppState.addEventListener('change',state=>{if(state==='active'){clearTimeout(timeout);subscription.remove();resolve();}});
            if(AppState.currentState==='active'){clearTimeout(timeout);subscription.remove();resolve();}
          });
          check();
          if(!permission.granted)throw new Error('Разрешите Connect доступ к микрофону.');
          await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});
          check();
          await recorder.prepareToRecordAsync();voicePrepared.current=true;
          check();
          recorder.record();voiceActive.current=true;began.current=performance.now();announce(true,'voice');
          meterTimer.current=setInterval(()=>{try{const level=recorder.getStatus().metering;callbacks.current.onLevel?.(typeof level==='number'?Math.min(1,Math.pow(10,level/20)*4):0);}catch{}},100);
        }catch(error){
          if(voicePrepared.current)await stopVoiceInternal(false).catch(()=>{});
          else await setAudioModeAsync({allowsRecording:false}).catch(()=>{});
          throw error;
        }
      });
    },
    stopVoice:(send=true)=>serialize(()=>stopVoiceInternal(send)),
    cancelVoice,
    openVideo:async()=>{
      if(videoOpening.current||videoResolver.current)throw new Error('Другая запись уже выполняется.');
      videoOpening.current=true;
      const requestedGeneration=generation.current;
      // Wait for any microphone operation, then claim capture synchronously.
      try{
        await queue.current.catch(()=>{});
        if(!mounted.current||requestedGeneration!==generation.current)throw new Error('Запись прервана. Повторите действие.');
          if(AppState.currentState==='background')throw new Error('Для записи вернитесь в Connect.');
        if(voiceActive.current||videoResolver.current)throw new Error('Другая запись уже выполняется.');
        return new Promise<HybridRecordingFile|null>(resolve=>{videoResolver.current=resolve;setVideoVisible(true);});
      }finally{videoOpening.current=false;}
    },
    cancelAll,
  }),[recorder,stopVoiceInternal,cancelVoice,cancelAll,announce]);
  return videoVisible?<VideoRecorder onFinish={finishVideo} onRecording={active=>announce(active,'video')}/>:null;
});
export default ConnectHybridRecorder;

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#090e14',paddingHorizontal:20,paddingTop:8,paddingBottom:18},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'},
  title:{color:'#eef2f6',fontSize:24,fontWeight:'600'},
  content:{flex:1,justifyContent:'center',alignItems:'center',gap:14},
  circle:{overflow:'hidden',backgroundColor:'#131b24',borderWidth:1,borderColor:'rgba(236,242,248,.32)',justifyContent:'center',alignItems:'center'},
  permissionText:{color:'#b9c3ce',fontSize:16,textAlign:'center',padding:24},
  previewOverlay:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:'rgba(5,10,16,.22)',alignItems:'center',justifyContent:'center'},
  play:{color:'#fff',fontSize:48},
  caption:{color:'#edf2f7',fontSize:18,fontWeight:'500',textAlign:'center'},
  hint:{color:'#a4afbb',fontSize:13,textAlign:'center'},
  problem:{color:'#ff95a3',fontSize:14,textAlign:'center'},
  controls:{flexDirection:'row',justifyContent:'center',alignItems:'center',flexWrap:'wrap',gap:12,paddingVertical:12},
  button:{borderRadius:20,borderWidth:1,borderColor:'rgba(230,238,246,.2)',backgroundColor:'rgba(220,230,240,.08)',paddingHorizontal:18,paddingVertical:13},
  buttonLabel:{color:'#edf2f7',fontSize:15,fontWeight:'500'},
  primary:{backgroundColor:'#dce5ed',borderColor:'#eef5fa'},
  primaryLabel:{color:'#101820'},
  disabled:{opacity:.45},
});
