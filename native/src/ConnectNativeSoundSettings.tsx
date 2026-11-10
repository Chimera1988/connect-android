/** Independent phone-selected notification and call sounds for Android.
 * Each selected file is imported to MediaStore by ConnectSoundModule, not kept
 * in a temporary document picker cache directory.
 */
import React,{useEffect,useState} from 'react';
import {ActivityIndicator,NativeModules,Platform,Pressable,Text,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import notifee,{AndroidImportance} from '@notifee/react-native';
import type {Palette} from './theme';

export type SoundKind='messages'|'calls';
export type SoundPreference={uri:string;name:string};
const STORAGE={messages:'connect-native-msg-sound-v2',calls:'connect-native-call-sound-v2'} as const;
const SILENT_STORAGE={messages:'connect-native-message-silent-v1',calls:'connect-native-call-silent-v1'} as const;
const DEFAULT_NAME='По умолчанию';
const MAX_SOUND=20*1024*1024;
const supported=/\.(mp3|m4a|aac|ogg|wav)$/i;
const native=NativeModules.ConnectSoundModule as {
  importSound?:(uri:string,name:string,kind:string)=>Promise<string>;
  previewSound?:(uri:string)=>Promise<boolean>;
  stopPreviewSound?:()=>Promise<boolean>;
  createCallChannel?:(id:string,sound:string,silent:boolean,vibrate:boolean)=>Promise<boolean>;
}|undefined;
export type BuiltinNotificationTone='soft'|'bright'|'gentle'|'silent';
export async function previewBuiltinSound(tone:BuiltinNotificationTone){
  if(tone==='silent')return;
  if(!native?.previewSound)throw new Error('Прослушивание доступно только в новом APK Connect');
  await native.previewSound('android.resource://com.connect.messenger/raw/connect_'+tone);
}
export async function stopSoundPreview(){await native?.stopPreviewSound?.();}
function hashUri(uri:string):string{
  // Non-cryptographic, stable channel key. A channel's sound cannot be edited
  // once Android creates it, hence a new channel for every imported sound.
  let hash=2166136261;
  for(let i=0;i<uri.length;i++){hash^=uri.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
}
function assertKind(kind:SoundKind){if(kind!=='calls'&&kind!=='messages')throw new Error('Неизвестная категория звука.');}
export async function getConnectSoundPreference(kind:SoundKind):Promise<SoundPreference|null>{
  assertKind(kind);
  try{
    const raw=await SecureStore.getItemAsync(STORAGE[kind]);
    if(!raw)return null;
    const value=JSON.parse(raw) as SoundPreference;
    return typeof value.uri==='string'&&value.uri.startsWith('content://media/')&&typeof value.name==='string'?value:null;
  }catch{return null;}
}
export async function getConnectSoundSilence(kind:SoundKind):Promise<boolean>{
  assertKind(kind);
  return await SecureStore.getItemAsync(SILENT_STORAGE[kind])==='yes';
}
export async function setConnectSoundSilence(kind:SoundKind,silent:boolean){
  assertKind(kind);
  await SecureStore.setItemAsync(SILENT_STORAGE[kind],silent?'yes':'no');
  await getConnectSoundChannel(kind);
}
export async function getConnectSoundChannel(kind:SoundKind,options?:{silent?:boolean;vibrate?:boolean;tone?:BuiltinNotificationTone}):Promise<string>{
  const pref=await getConnectSoundPreference(kind);
  const silent=options?.silent===true||await getConnectSoundSilence(kind);
  let savedVibration=true;
  if(kind==='calls')try{
    const prefs=JSON.parse(await SecureStore.getItemAsync('connect-native-notifications-v1')||'null');
    if(typeof prefs?.vibrate==='boolean')savedVibration=prefs.vibrate;
  }catch{/* A corrupt preference keeps Android's normal call vibration. */}
  const vibration=options?.vibrate??savedVibration;
  const tone=options?.tone&&options.tone!=='silent'?options.tone:'soft';
  const soundName=kind==='messages'?'connect_'+tone:'content://settings/system/ringtone';
  const channelId=`connect-native-${kind}-${pref?'chosen-'+hashUri(pref.uri)+'-v5':(kind==='calls'?'ringtone':soundName)+'-v5'}-${silent?'silent':'audible'}-${vibration?'vib':'still'}`;
  if(kind==='calls'){
    // The coordinator owns the ringtone/vibrator. Its stable notification
    // channel is silent and keeps the user's Android importance/DND choices.
    if(!NativeModules.ConnectCallCoordinator)throw Error('Нативная система звонков недоступна');
    return NativeModules.ConnectCallCoordinator.configureSounds(pref?.uri||'',silent,vibration,channelId);
  }
  await notifee.createChannel({
    id:channelId,name:'Connect · Новые сообщения',
    description:'Звук входящих сообщений Connect',
    // Silent incoming calls still need heads-up/full-screen presentation.
    importance:AndroidImportance.HIGH,
    sound:silent?undefined:pref?.uri||soundName,vibration,
  });
  return channelId;
}
let choosing=false;
/** Invoked directly by settings or the trusted WebView bridge; Android owns the picker. */
export async function chooseConnectSound(kind:SoundKind):Promise<SoundPreference|null>{
  assertKind(kind);
  if(choosing)throw new Error('Выбор мелодии уже открыт.');
  if(Platform.OS!=='android'||!native?.importSound)throw new Error('Нативный модуль выбора звуков недоступен.');
  choosing=true;
  try{
    await stopSoundPreview();
    const selected=await DocumentPicker.getDocumentAsync({type:['audio/*','application/ogg'],multiple:false,copyToCacheDirectory:true});
    if(selected.canceled||!selected.assets.length)return null;
    const file=selected.assets[0];
    if(!supported.test(file.name))throw new Error('Выберите MP3, M4A, AAC, OGG или WAV.');
    // Some DocumentsProviders omit size. The native import enforces the actual
    // byte limit while copying, rather than rejecting a valid cloud document.
    if(file.size!==undefined&&(file.size<=0||file.size>MAX_SOUND))throw new Error('Мелодия должна быть от 1 байта до 20 МБ.');
    const uri=await native.importSound(file.uri,file.name,kind);
    if(!uri.startsWith('content://media/'))throw new Error('Android не сохранил звук в медиатеку.');
    const pref:SoundPreference={uri,name:file.name};
    await SecureStore.setItemAsync(STORAGE[kind],JSON.stringify(pref));
    await getConnectSoundChannel(kind);
    return pref;
  }finally{choosing=false;}
}
export async function previewConnectSound(kind:SoundKind){
  const pref=await getConnectSoundPreference(kind);
  if(!native?.previewSound)throw new Error('Прослушивание доступно только в обновлённом APK');
  // Match the notification channel's built-in soft tone, not Android's unrelated
  // default notification sound. A chosen URI always takes precedence.
  await native.previewSound(pref?.uri||(kind==='calls'?'default-ringtone':'android.resource://com.connect.messenger/raw/connect_soft'));
}
export async function resetConnectSound(kind:SoundKind){
  assertKind(kind);
  await stopSoundPreview();
  await SecureStore.deleteItemAsync(STORAGE[kind]);
  await getConnectSoundChannel(kind);
}
export default function ConnectNativeSoundSettings({colors}:{colors:Palette}){
  const [picked,setPicked]=useState<Record<SoundKind,string>>({messages:DEFAULT_NAME,calls:DEFAULT_NAME});
  const [busy,setBusy]=useState<SoundKind|null>(null);
  const [previewing,setPreviewing]=useState<SoundKind|null>(null);
  const [problem,setProblem]=useState('');
  useEffect(()=>()=>{void stopSoundPreview().catch(()=>{});},[]);
  async function preview(kind:SoundKind){
    try{
      setProblem('');
      if(previewing===kind){await stopSoundPreview();setPreviewing(null);return;}
      await previewConnectSound(kind);
      setPreviewing(kind);
    }catch(e){setProblem(e instanceof Error?e.message:String(e));setPreviewing(null);}
  }
  useEffect(()=>{
    let active=true;
    void Promise.all([getConnectSoundPreference('messages'),getConnectSoundPreference('calls')]).then(([messages,calls])=>{
      if(active)setPicked({messages:messages?.name||DEFAULT_NAME,calls:calls?.name||DEFAULT_NAME});
    });
    return()=>{active=false;};
  },[]);
  async function choose(kind:SoundKind){
    if(busy)return;
    setProblem('');setBusy(kind);
    try{
      const pref=await chooseConnectSound(kind);
      if(pref)setPicked(prev=>({...prev,[kind]:pref.name}));
      setPreviewing(null);
    }catch(e){setProblem(e instanceof Error?e.message:String(e));}
    finally{setBusy(null);}
  }
  async function restore(kind:SoundKind){
    if(busy)return;
    setProblem('');setBusy(kind);
    try{
      await resetConnectSound(kind);setPreviewing(null);
      setPicked(prev=>({...prev,[kind]:DEFAULT_NAME}));
    }catch(e){setProblem(e instanceof Error?e.message:String(e));}
    finally{setBusy(null);}
  }
  const row=(kind:SoundKind,title:string)=>
    <View key={kind} style={{paddingVertical:13,borderBottomWidth:1,borderBottomColor:colors.line,gap:8}}>
      <Text style={{color:colors.text,fontWeight:'600',fontSize:15}}>{title}</Text>
      <Text numberOfLines={2} style={{color:colors.muted,fontSize:12}}>{picked[kind]}</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center'}}>
        <Pressable accessibilityRole="button" disabled={!!busy} onPress={()=>void choose(kind)} style={{borderRadius:12,paddingVertical:10,paddingHorizontal:14,backgroundColor:colors.elevated,borderWidth:1,borderColor:colors.line}}>
          <Text style={{color:colors.accent,fontWeight:'600'}}>Выбрать файл</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!!busy} accessibilityLabel={previewing===kind?'Остановить звук':'Прослушать звук'} onPress={()=>void preview(kind)} style={{padding:10}}>
          <Text style={{color:colors.accent}}>{previewing===kind?'■ Стоп':'▶ Прослушать'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!!busy||picked[kind]===DEFAULT_NAME} onPress={()=>void restore(kind)} style={{padding:10,opacity:picked[kind]===DEFAULT_NAME?0.45:1}}>
          <Text style={{color:colors.muted}}>Сбросить</Text>
        </Pressable>
        {busy===kind&&<ActivityIndicator color={colors.accent}/>}
      </View>
    </View>;
  return <View style={{marginTop:20,padding:15,borderRadius:18,backgroundColor:colors.surface,borderColor:colors.line,borderWidth:1}}>
    <Text style={{fontSize:17,color:colors.text,fontWeight:'700'}}>Звуки уведомлений</Text>
    {row('calls','Входящий аудиозвонок')}
    {row('messages','Новое сообщение')}
    <Text style={{color:colors.muted,fontSize:11,marginTop:11,lineHeight:16}}>
      Свои мелодии хранятся в системной медиатеке Android. Громкость, режим «Не беспокоить» и настройки категорий уведомлений имеют приоритет.
    </Text>
    {!!problem&&<Text style={{color:colors.danger,marginTop:8,fontSize:12}}>{problem}</Text>}
  </View>;
}
