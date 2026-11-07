/**
 * Connect Native: record video notes inside the current chat (no external camera app).
 * Filename is intentionally compatible with the PWA video-note detector.
 */
import React, {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Linking,Modal,Pressable,Text,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {CameraView,useCameraPermissions,useMicrophonePermissions} from 'expo-camera';
import {File} from 'expo-file-system';
import {useVideoPlayer,VideoView} from 'expo-video';
import type {Palette} from './theme';
import type {LocalUpload} from './nativeMediaUtils';

const MAX_SECONDS=60;
const MAX_BYTES=18*1024*1024;
type Phase='idle'|'recording'|'preview'|'sending';
const errorString=(error:unknown)=>error instanceof Error?error.message:String(error);

function Preview({uri,colors}:{uri:string;colors:Palette}){
  const player=useVideoPlayer(uri,p=>{p.loop=true;});
  const [playing,setPlaying]=useState(false);
  useEffect(()=>()=>{try{player.pause();}catch{}},[player]);
  return <Pressable onPress={()=>{if(playing)player.pause();else player.play();setPlaying(!playing);}}
      accessibilityRole="button" accessibilityLabel={playing?'Приостановить видеокружок':'Просмотреть видеокружок'}
      style={{width:270,height:270,borderRadius:135,overflow:'hidden',borderWidth:3,borderColor:colors.accent,backgroundColor:'#08121d'}}>
    <VideoView player={player} nativeControls={false} contentFit="cover" surfaceType="textureView" style={{width:'100%',height:'100%'}}/>
    {!playing&&<View pointerEvents="none" style={{position:'absolute',top:0,right:0,bottom:0,left:0,alignItems:'center',justifyContent:'center',backgroundColor:'#050d183a'}}>
      <Ionicons name="play-circle" size={58} color="#fff"/>
    </View>}
  </Pressable>;
}

export default function ConnectNativeVideoNote({visible,colors,onClose,onSend}:{
  visible:boolean;colors:Palette;onClose:()=>void;onSend:(file:LocalUpload)=>Promise<boolean>;
}){
  const camera=useRef<CameraView|null>(null);
  const [cameraPermission,requestCamera]=useCameraPermissions();
  const [microphonePermission,requestMic]=useMicrophonePermissions();
  const [phase,setPhase]=useState<Phase>('idle');
  const [ready,setReady]=useState(false);
  const [facing,setFacing]=useState<'front'|'back'>('front');
  const [previewUri,setPreviewUri]=useState<string|null>(null);
  const [seconds,setSeconds]=useState(0);
  const [error,setError]=useState('');
  const ignored=useRef(false);
  const mounted=useRef(true);
  const recording=useRef(false);
  useEffect(()=>{
    mounted.current=true;
    return()=>{
      mounted.current=false;
      ignored.current=true;
      if(recording.current)try{camera.current?.stopRecording();}catch{}
    };
  },[]);
  useEffect(()=>{
    if(!visible){
      ignored.current=true;
      if(recording.current)try{camera.current?.stopRecording();}catch{}
      setPreviewUri(null);setReady(false);setPhase('idle');setSeconds(0);setError('');
    }else ignored.current=false;
  },[visible]);
  const allowed=Boolean(cameraPermission?.granted&&microphonePermission?.granted);

  async function grant(){
    try{
      const cp=cameraPermission?.granted?cameraPermission:await requestCamera();
      const mp=microphonePermission?.granted?microphonePermission:await requestMic();
      if(!cp?.granted||!mp?.granted)setError('Для видеокружка разрешите камеру и микрофон.');
      else setError('');
    }catch(e){setError(errorString(e));}
  }
  function close(){
    ignored.current=true;
    if(recording.current)try{camera.current?.stopRecording();}catch{}
    onClose();
  }
  async function start(){
    if(!camera.current||!ready||phase!=='idle'||!allowed)return;
    ignored.current=false;recording.current=true;
    setError('');setSeconds(0);setPhase('recording');
    try{
      const result=await camera.current.recordAsync({maxDuration:MAX_SECONDS,maxFileSize:MAX_BYTES,progressUpdateInterval:.5});
      recording.current=false;
      if(!mounted.current||ignored.current)return;
      if(!result?.uri)throw Error('Видео не сохранилось');
      const size=new File(result.uri).size;
      if(!size||size>MAX_BYTES)throw Error('Размер видеокружка превысил ограничение.');
      setPreviewUri(result.uri);setPhase('preview');
    }catch(e){
      recording.current=false;
      if(mounted.current&&!ignored.current){setError('Не удалось записать видео: '+errorString(e));setPhase('idle');}
    }
  }
  function stop(){if(phase==='recording'&&recording.current)camera.current?.stopRecording();}
  async function send(){
    if(!previewUri||phase!=='preview')return;
    setPhase('sending');setError('');
    try{
      const file:LocalUpload={uri:previewUri,name:`connect-video-note-${Date.now()}.mp4`,mime:'video/mp4',size:new File(previewUri).size};
      const success=await onSend(file);
      if(success){onClose();return;}
      setError('Не удалось отправить видеокружок. Можно попробовать снова.');
    }catch(e){setError('Отправка: '+errorString(e));}
    if(mounted.current)setPhase('preview');
  }
  const caption=phase==='recording'?`Запись ${seconds} / ${MAX_SECONDS} с`:phase==='preview'?'Предпросмотр видеокружка':'Снимите видеокружок';
  const button=(label:string,fn:()=>void,primary=false,disabled=false)=>
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={fn}
      style={{paddingHorizontal:17,paddingVertical:12,borderRadius:16,backgroundColor:primary?colors.accent:colors.elevated,opacity:disabled ? .5 : 1}}>
      <Text style={{color:primary?'#fff':colors.text,fontWeight:'700',fontSize:15}}>{label}</Text>
    </Pressable>;
  return <Modal visible={visible} animationType="slide" onRequestClose={close} transparent={false}>
    <View style={{flex:1,backgroundColor:colors.bg,padding:20,alignItems:'center',justifyContent:'space-between'}}>
      <View style={{width:'100%',paddingTop:24,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
        <Text style={{fontSize:23,fontWeight:'700',color:colors.text}}>Видеокружок</Text>
        {button('Закрыть',close)}
      </View>
      <View style={{alignItems:'center',gap:19,width:'100%'}}>
        {allowed ? (previewUri ? <Preview uri={previewUri} colors={colors}/>:
          <View style={{width:270,height:270,borderRadius:135,overflow:'hidden',borderWidth:3,borderColor:colors.accent,backgroundColor:'#09111d'}}>
            {visible&&<CameraView ref={camera} style={{width:'100%',height:'100%'}} facing={facing} mode="video" mute={false}
              videoQuality="480p" videoBitrate={850000} onCameraReady={()=>setReady(true)}
              onRecordingProgress={e=>setSeconds(Math.ceil(e.duration))}
              onMountError={e=>setError('Камера: '+e.message)}/>}
          </View>) : <View style={{width:270,height:270,borderRadius:135,backgroundColor:colors.elevated,alignItems:'center',justifyContent:'center'}}>
              <Ionicons name="videocam-outline" color={colors.accent} size={68}/>
            </View>}
        <Text style={{fontSize:16,color:colors.text,textAlign:'center'}}>{caption}</Text>
        <Text style={{fontSize:12,color:colors.muted,textAlign:'center'}}>До 60 секунд · запись внутри Connect · перед отправкой можно пересмотреть</Text>
        {!!error&&<Text style={{fontSize:13,color:colors.danger,textAlign:'center'}}>{error}</Text>}
      </View>
      <View style={{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:12,flexWrap:'wrap',paddingBottom:34}}>
        {!allowed ? <>
          {button('Разрешить доступ',()=>{void grant();},true)}
          {(cameraPermission?.canAskAgain===false||microphonePermission?.canAskAgain===false)&&button('Настройки Android',()=>{void Linking.openSettings();})}
        </>:phase==='idle'?<>
          {button('Сменить камеру',()=>{setReady(false);setFacing(x=>x==='front'?'back':'front');})}
          {button('● Записать',()=>{void start();},true,!ready)}
        </>:phase==='recording'?<>
          {button('Остановить',stop,true)}
        </>:phase==='sending'?<ActivityIndicator color={colors.accent}/>:<>
          {button('Переснять',()=>{setPreviewUri(null);setReady(false);setSeconds(0);setPhase('idle');})}
          {button('Отправить',()=>{void send();},true)}
        </>}
      </View>
    </View>
  </Modal>;
}
