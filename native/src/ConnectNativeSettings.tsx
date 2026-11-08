/** PWA settings hierarchy ported to native React Native: no WebView, no APK build. */
import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Image,Pressable,ScrollView,Switch,Text,TextInput,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {File} from 'expo-file-system';
import {db} from './backend';
import {uploadFile} from './nativeMediaUtils';
import ConnectNativeAvatarCropper,{type AvatarSource,type CroppedAvatar} from './ConnectNativeAvatarCropper';
import {glassColor} from './ConnectNativeGlass';
import {BUILTIN_PACKS,ACCENTS,type AppearanceController} from './ConnectNativeAppearance';
import {palettes,themeNames,type Palette} from './theme';
import ConnectNativeSoundSettings,{previewBuiltinSound} from './ConnectNativeSoundSettings';
import {testNativeMessagePush} from './ConnectNativePush';
import ConnectNativeStickerManager from './ConnectNativeStickerManager';
import ConnectNativeSonicRunner from './ConnectNativeSonicRunner';

type Page='home'|'appearance'|'stickers'|'notifications'|'data'|'privacy'|'about';
type Profile={id:string;display_name:string;bio:string|null;avatar_path:string|null};
type Props={
  owner:Profile|null;email:string;colors:Palette;appearance:AppearanceController;
  admin:boolean;onInvite:()=>void;onProfile:()=>void;onLogout:()=>void;
  onProfileSaved:()=>Promise<void>;
};
const PWA_VERSION='1.5';
const BASE=(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'');
const NOTIFICATION_KEY='connect-native-notifications-v1';
type NotificationPref={enabled:boolean;vibrate:boolean;sound:'soft'|'bright'|'gentle'|'silent'};
const DEFAULT_NOTIFICATIONS:NotificationPref={enabled:true,vibrate:true,sound:'soft'};
const SOUND_OPTIONS:[NotificationPref['sound'],string][]=[['soft','Мягкий'],['bright','Яркий'],['gentle','Нежный'],['silent','Без звука']];
function errorOf(e:unknown){return e instanceof Error?e.message:String(e);}

function Row({icon,title,subtitle,onPress,colors,danger=false}: {icon:keyof typeof Ionicons.glyphMap;title:string;subtitle?:string;onPress:()=>void;colors:Palette;danger?:boolean}){
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={{minHeight:66,padding:13,borderRadius:18,borderWidth:1,borderColor:glassColor(colors.text,.13),backgroundColor:glassColor(colors.surface,.9),flexDirection:'row',alignItems:'center',gap:13,marginBottom:8}}>
    <Ionicons name={icon} size={22} color={danger?colors.danger:colors.accent}/>
    <View style={{flex:1,gap:4}}><Text style={{fontSize:15,fontWeight:'700',color:danger?colors.danger:colors.text}}>{title}</Text>
      {!!subtitle&&<Text style={{fontSize:12,color:colors.muted}}>{subtitle}</Text>}</View>
    <Ionicons name="chevron-forward" size={18} color={colors.muted}/>
  </Pressable>;
}
function Heading({children,colors}:{children:string;colors:Palette}){
  return <Text style={{fontSize:17,fontWeight:'700',color:colors.text,marginTop:22,marginBottom:10}}>{children}</Text>;
}
function Panel({children,colors}:{children:React.ReactNode;colors:Palette}){
  return <View style={{borderWidth:1,borderColor:glassColor(colors.text,.12),backgroundColor:glassColor(colors.surface,.83),borderRadius:19,padding:14,gap:10}}>{children}</View>;
}
function SmallButton({label,onPress,colors,disabled=false,danger=false}:{label:string;onPress:()=>void;colors:Palette;disabled?:boolean;danger?:boolean}){
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={{paddingVertical:11,paddingHorizontal:13,borderRadius:13,backgroundColor:danger?glassColor(colors.danger,.15):glassColor(colors.accent,.14),opacity:disabled ? .5 : 1}}>
    <Text style={{color:danger?colors.danger:colors.accent,textAlign:'center',fontWeight:'700'}}>{label}</Text>
  </Pressable>;
}

export default function ConnectNativeSettings({owner,email,colors,appearance,admin,onInvite,onProfile,onLogout,onProfileSaved}:Props){
  const [page,setPage]=useState<Page>('home');
  const [gameOpen,setGameOpen]=useState(false);
  const [notification,setNotification]=useState<NotificationPref>(DEFAULT_NOTIFICATIONS);
  const [pushDiagnostic,setPushDiagnostic]=useState('');
  const [pushBusy,setPushBusy]=useState(false);
  const [notices,setNotices]=useState('');
  const [working,setWorking]=useState(false);
  const [deletePassword,setDeletePassword]=useState('');
  const [exportSummary,setExportSummary]=useState('');
  const [newName,setNewName]=useState(owner?.display_name||'');
  const [newBio,setNewBio]=useState(owner?.bio||'');
  const [profileEdit,setProfileEdit]=useState(false);
  const [cropAsset,setCropAsset]=useState<AvatarSource|null>(null);
  const a=appearance.prefs;
  useEffect(()=>{setNewName(owner?.display_name||'');setNewBio(owner?.bio||'');},[owner?.display_name,owner?.bio]);
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try {
        const local=await SecureStore.getItemAsync(NOTIFICATION_KEY);
        if(local&&alive){const parsed=JSON.parse(local) as NotificationPref;
          if(typeof parsed.enabled==='boolean'&&typeof parsed.vibrate==='boolean'&&SOUND_OPTIONS.some(x=>x[0]===parsed.sound))setNotification(parsed);
        }
        if(owner){const r=await db.from('notification_preferences').select('enabled,sound,vibrate').eq('user_id',owner.id).maybeSingle();
          const saved=r.data;
          if(alive&&!r.error&&saved&&SOUND_OPTIONS.some(x=>x[0]===saved.sound))setNotification(saved as NotificationPref);
        }
      }catch{/* Keep defaults when offline. */}
    })();return()=>{alive=false};
  },[owner?.id]);
  async function saveNotification(next:NotificationPref){
    setNotification(next);setNotices('Сохраняем уведомления…');
    try {
      await SecureStore.setItemAsync(NOTIFICATION_KEY,JSON.stringify(next));
      if(!owner)throw Error('Требуется авторизация');
      const result=await db.from('notification_preferences').upsert({user_id:owner.id,...next,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if(result.error)throw result.error;
      setNotices('Настройки уведомлений сохранены');
    }catch(e){setNotices('Не удалось сохранить настройки уведомлений: '+errorOf(e));}
  }
  async function chooseWallpaper(){
    try{
      const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:false,quality:.8});
      if(picked.canceled||!picked.assets[0])return;
      const asset=picked.assets[0];
      if((asset.fileSize||0)>12*1024*1024)throw Error('Изображение больше 12 МБ');
      if(!FileSystem.documentDirectory)throw Error('Каталог устройства недоступен');
      const destination=FileSystem.documentDirectory+'connect-native-chat-wallpaper.jpg';
      await FileSystem.deleteAsync(destination,{idempotent:true}).catch(()=>{});
      await FileSystem.copyAsync({from:asset.uri,to:destination});
      appearance.update({wallpaper:destination});
      setNotices('Фон переписки сохранён на устройстве');
    }catch(e){setNotices('Не удалось выбрать фон: '+errorOf(e));}
  }
  async function clearWallpaper(){
    const old=a.wallpaper;appearance.update({wallpaper:null});
    if(old)await FileSystem.deleteAsync(old,{idempotent:true}).catch(()=>{});
  }
  async function resetLocal(){
    Alert.alert('Сбросить настройки?','Тема, цвет, фон и выбранные наборы стикеров вернутся к значениям по умолчанию. Сообщения останутся.',[
      {text:'Отмена',style:'cancel'},
      {text:'Сбросить',style:'destructive',onPress:()=>{void clearWallpaper();appearance.reset();setNotices('Локальные настройки сброшены');}},
    ]);
  }
  async function exportChats(){
    if(!owner)return;
    setWorking(true);setExportSummary('Подготавливаем данные…');
    try{
      const c=await db.from('conversations').select('id,user_a,user_b,created_at').or(`user_a.eq.${owner.id},user_b.eq.${owner.id}`).limit(1000);
      if(c.error)throw c.error;
      const conversations=c.data||[];
      const messages:unknown[]=[];
      for(const row of conversations){
        for(let start=0;start<50000-messages.length;start+=500){
          const data=await db.from('messages').select('*').eq('conversation_id',row.id).order('created_at',{ascending:true}).range(start,start+499);
          if(data.error)throw data.error;
          messages.push(...(data.data||[]));
          if(!data.data||data.data.length<500)break;
        }
        if(messages.length>=50000)break;
      }
      const json=JSON.stringify({exported_at:new Date().toISOString(),account_id:owner.id,conversations,messages},null,2);
      if(!FileSystem.documentDirectory)throw Error('Нет доступного каталога для экспорта.');
      if(!await Sharing.isAvailableAsync())throw Error('Системное меню отправки файлов недоступно.');
      // An intentionally local, explicit export. Never upload chat contents.
      const filename=`connect-chats-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
      const uri=FileSystem.documentDirectory+filename;
      await FileSystem.writeAsStringAsync(uri,json,{encoding:FileSystem.EncodingType.UTF8});
      setExportSummary(`Подготовлено ${messages.length} сообщений (${Math.round(json.length/1024)} КБ). Выберите, куда сохранить JSON.`);
      await Sharing.shareAsync(uri,{mimeType:'application/json',dialogTitle:'Экспорт переписок Connect'});
    }catch(e){setExportSummary('Ошибка подготовки экспорта: '+errorOf(e));}
    finally{setWorking(false);}
  }
  async function saveProfile(){
    if(!owner||!newName.trim()||working)return;
    setWorking(true);setNotices('Сохраняем профиль…');
    try{
      const result=await db.from('profiles').update({display_name:newName.trim().slice(0,60),bio:newBio.trim().slice(0,160)}).eq('id',owner.id);
      if(result.error)throw result.error;
      await onProfileSaved();setProfileEdit(false);setNotices('Профиль сохранён');
    }catch(e){setNotices('Ошибка профиля: '+errorOf(e));}finally{setWorking(false);}
  }
  async function chooseAvatar(){
    if(!owner||working)return;
    try{
      const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:false,quality:1});
      if(picked.canceled||!picked.assets[0])return;
      const item=picked.assets[0];
      if(!item.width||!item.height)throw Error('Не удалось прочитать размеры фотографии');
      setCropAsset({uri:item.uri,width:item.width,height:item.height});
    }catch(e){setNotices('Не удалось открыть фотографию: '+errorOf(e));}
  }
  async function saveCroppedAvatar(file:CroppedAvatar){
    if(!owner||working)return;
    setWorking(true);
    try{
      const path=`${owner.id}/avatar-${Date.now()}.jpg`;
      await uploadFile('connect-avatars',path,{uri:file.uri,name:'avatar.jpg',mime:'image/jpeg',size:file.size});
      const result=await db.from('profiles').update({avatar_path:path}).eq('id',owner.id);
      if(result.error)throw result.error;
      await onProfileSaved();setCropAsset(null);setNotices('Аватар обновлён');
    }finally{setWorking(false);}
  }
  async function deleteAccount(){
    if(!deletePassword||working)return;
    setWorking(true);
    try{
      const {data:{session}}=await db.auth.getSession();
      if(!session?.access_token)throw Error('Войдите снова');
      const res=await fetch(BASE+'/api/account/delete',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({password:deletePassword})});
      const value=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(value.error||`Ошибка HTTP ${res.status}`);
      await db.auth.signOut();onLogout();
    }catch(e){setNotices('Не удалось удалить аккаунт: '+errorOf(e));}finally{setWorking(false);}
  }
  const title={home:'Настройки',appearance:'Оформление',stickers:'Стикеры',notifications:'Уведомления',data:'Данные и хранилище',privacy:'Приватность',about:'О приложении'}[page];
  const pageRows: {page:Page;icon:keyof typeof Ionicons.glyphMap;title:string;subtitle:string}[]=[
    {page:'appearance',icon:'color-palette-outline',title:'Оформление',subtitle:'Тема, цвет и фон чатов'},
    {page:'stickers',icon:'happy-outline',title:'Стикеры',subtitle:'Наборы и избранное'},
    {page:'notifications',icon:'notifications-outline',title:'Уведомления',subtitle:'Звуки и push-уведомления'},
    {page:'data',icon:'folder-outline',title:'Данные и хранилище',subtitle:'Экспорт и очистка'},
    {page:'privacy',icon:'shield-checkmark-outline',title:'Приватность',subtitle:'Безопасность переписок'},
    {page:'about',icon:'information-circle-outline',title:'О приложении',subtitle:'Версия и разработчики'},
  ];
  return <View style={{flex:1}}>
    <View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingTop:13,paddingBottom:8,gap:10}}>
      {page!=='home'&&<Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={()=>{setPage('home');setNotices('');}}><Ionicons name="chevron-back" size={29} color={colors.accent}/></Pressable>}
      <Text style={{color:colors.text,fontWeight:'800',fontSize:26}}>{title}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:15,paddingTop:8,paddingBottom:125}}>
      {page==='home'&&<>
        <Row icon="person-circle-outline" title={owner?.display_name||'Мой профиль'} subtitle={owner?.bio||email} colors={colors} onPress={onProfile}/>
        {pageRows.map(r=><Row key={r.page} colors={colors} icon={r.icon} title={r.title} subtitle={r.subtitle} onPress={()=>{setPage(r.page);setNotices('');}}/>)}
        <Row icon="game-controller-outline" title="Если скучно" subtitle="Соник: прыжки, роботы и кольца" colors={colors} onPress={()=>setGameOpen(true)}/>
        {admin&&<Row icon="people-outline" title="Управление участниками" subtitle="Приглашения в Connect" colors={colors} onPress={onInvite}/>}
        <Row icon="log-out-outline" title="Выйти из аккаунта" colors={colors} danger onPress={onLogout}/>
      </>}
      {page==='appearance'&&<>
        <Heading colors={colors}>Тема приложения</Heading>
        <Panel colors={colors}>
          <Text style={{color:colors.text}}>Режим отображения</Text>
          <View style={{flexDirection:'row',gap:8}}>{(['dark','light'] as const).map(mode=><Pressable key={mode} onPress={()=>appearance.update({mode})} accessibilityRole="button" accessibilityState={{selected:a.mode===mode}} style={{flex:1,borderRadius:13,padding:13,backgroundColor:a.mode===mode?glassColor(colors.accent,.2):colors.elevated,borderWidth:1,borderColor:a.mode===mode?colors.accent:colors.line}}><Text style={{textAlign:'center',color:colors.text,fontWeight:'700'}}>{mode==='dark'?'Тёмная':'Светлая'} {a.mode===mode?'✓':''}</Text></Pressable>)}</View>
        </Panel>
        <Heading colors={colors}>Темы оформления</Heading>
        <Text style={{color:colors.muted,fontSize:12,marginBottom:10}}>Семь сцен PWA. Тема и цвет кнопок настраиваются отдельно.</Text>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{themeNames.map(scene=><Pressable key={scene.id} onPress={()=>appearance.update({scene:scene.id})} accessibilityRole="button" accessibilityState={{selected:a.scene===scene.id}} style={{width:'47%',minHeight:86,borderWidth:a.scene===scene.id?2:1,borderColor:a.scene===scene.id?colors.accent:colors.line,borderRadius:19,overflow:'hidden',padding:10,justifyContent:'flex-end',backgroundColor:colors.elevated}}>
          <View style={{height:43,width:'100%',borderRadius:11,marginBottom:9,backgroundColor:palettes[scene.id].bg,overflow:'hidden',padding:6,justifyContent:'space-between'}}>
            <View style={{height:8,width:'65%',alignSelf:'flex-start',borderRadius:9,backgroundColor:palettes[scene.id].surface}}/>
            <View style={{flexDirection:'row',alignItems:'flex-end',gap:5}}>
              <View style={{height:16,width:'42%',borderRadius:9,backgroundColor:palettes[scene.id].elevated}}/>
              <View style={{height:12,width:'32%',borderRadius:9,backgroundColor:palettes[scene.id].accent,opacity:.72}}/>
            </View>
          </View>
          <Text style={{color:colors.text,fontWeight:'700'}}>{scene.name}{a.scene===scene.id?' ✓':''}</Text>
        </Pressable>)}</View>
        <Heading colors={colors}>Цветовая схема</Heading>
        <Panel colors={colors}>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:11}}>{ACCENTS.map(color=><Pressable key={color} onPress={()=>appearance.update({accent:color})} accessibilityRole="button" accessibilityLabel={'Цвет '+color} style={{width:37,height:37,borderRadius:19,backgroundColor:color,borderWidth:a.accent===color?3:0,borderColor:colors.text,alignItems:'center',justifyContent:'center'}}>{a.accent===color&&<Ionicons name="checkmark" size={19} color="#fff"/>}</Pressable>)}</View>
          <TextInput placeholder="Свой цвет, например #087dff" value={a.accent} onChangeText={value=>{if(/^#[\da-f]{6}$/i.test(value))appearance.update({accent:value});}} placeholderTextColor={colors.muted} autoCapitalize="none" style={{color:colors.text,borderWidth:1,borderColor:colors.line,borderRadius:11,padding:12}}/>
        </Panel>
        <Heading colors={colors}>Фон переписок</Heading>
        <Panel colors={colors}>
          {a.wallpaper&&<Image source={{uri:a.wallpaper}} resizeMode="cover" style={{height:145,borderRadius:13}}/>}
          <SmallButton colors={colors} label="Выбрать изображение" onPress={()=>void chooseWallpaper()}/>
          {!!a.wallpaper&&<SmallButton colors={colors} label="Удалить фон" onPress={()=>void clearWallpaper()}/>} 
          <Text style={{color:colors.muted,fontSize:11}}>Фон хранится на этом устройстве. До 12 МБ.</Text>
        </Panel>
      </>}
      {page==='stickers'&&<>
        <Text style={{color:colors.muted,marginVertical:10,fontSize:13}}>Общие наборы доступны всем. Выбери, какие показывать в чате.</Text>
        {BUILTIN_PACKS.map(p=><Panel key={p.id} colors={colors}><View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={{fontSize:26}}>{p.emoji}</Text><View style={{flex:1}}><Text style={{color:colors.text,fontWeight:'700'}}>{p.name}</Text><Text style={{color:colors.muted,fontSize:12}}>24 стикера</Text></View><Switch value={a.enabledPacks.includes(p.id)} onValueChange={value=>appearance.update({enabledPacks:value?[...a.enabledPacks,p.id]:a.enabledPacks.filter(id=>id!==p.id)})} trackColor={{true:colors.accent}}/></View></Panel>)}
        <Heading colors={colors}>Мои наборы</Heading>
        {owner&&<ConnectNativeStickerManager colors={colors} ownerId={owner.id}/>}
      </>}
      {page==='notifications'&&<>
        <Panel colors={colors}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{color:colors.text,flex:1}}>Уведомления включены</Text><Switch value={notification.enabled} onValueChange={enabled=>void saveNotification({...notification,enabled})} trackColor={{true:colors.accent}}/></View>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{color:colors.text,flex:1}}>Вибрация</Text><Switch value={notification.vibrate} onValueChange={vibrate=>void saveNotification({...notification,vibrate})} trackColor={{true:colors.accent}}/></View>
          <Text style={{color:colors.text,fontWeight:'700'}}>Сигнал для всех чатов</Text>
          {SOUND_OPTIONS.map(([sound,label])=><View key={sound} style={{flexDirection:'row',gap:8,alignItems:'center'}}>
            <View style={{flex:1}}><SmallButton colors={colors} label={(notification.sound===sound?'✓ ':'')+label} onPress={()=>void saveNotification({...notification,sound})}/></View>
            {sound!=='silent'&&<SmallButton colors={colors} label="▶" onPress={()=>void previewBuiltinSound(sound).catch(e=>setNotices('Прослушивание: '+errorOf(e)))}/>} 
          </View>)}
        </Panel>
        <Heading colors={colors}>Звуки Android</Heading>
        <ConnectNativeSoundSettings colors={colors}/>
        <Heading colors={colors}>Диагностика уведомлений Android</Heading>
        <Panel colors={colors}>
          <Text style={{color:colors.muted,fontSize:12}}>Проверит системное разрешение, регистрацию Firebase и покажет тестовое локальное уведомление. Для проверки настоящей доставки попросите другого пользователя отправить сообщение, когда Connect в фоне.</Text>
          <SmallButton colors={colors} label={pushBusy?'Проверяем…':'Проверить и показать тестовое уведомление'} disabled={pushBusy}
            onPress={()=>{if(!owner){setPushDiagnostic('Войдите в аккаунт');return;}
              setPushBusy(true);setPushDiagnostic('Проверяем…');
              void testNativeMessagePush(owner.id).then(setPushDiagnostic)
                .catch(e=>setPushDiagnostic('Ошибка: '+errorOf(e))).finally(()=>setPushBusy(false));}}/>
          {!!pushDiagnostic&&<Text style={{color:colors.text,fontSize:12}}>{pushDiagnostic}</Text>}
        </Panel>
        <Text style={{color:colors.muted,fontSize:12,marginTop:12}}>Тестовое уведомление подтверждает работу Android-канала, но не доказывает доставку серверного FCM.</Text>
      </>}
      {page==='data'&&<>
        <Heading colors={colors}>Локальные данные</Heading>
        <Panel colors={colors}><Text style={{color:colors.muted}}>Сброс темы, цвета, обоев и настроек стикеров. Переписки и файлы останутся на сервере.</Text><SmallButton colors={colors} label="Очистить локальные настройки" onPress={()=>void resetLocal()}/></Panel>
        <Heading colors={colors}>Экспорт переписок</Heading>
        <Panel colors={colors}><Text style={{color:colors.muted}}>Создать JSON-файл до 50 000 сообщений и сохранить его через системное меню Android. Файл не отправляется без вашего выбора.</Text><SmallButton colors={colors} disabled={working} label="Создать и сохранить JSON-файл" onPress={()=>void exportChats()}/><Text style={{fontSize:12,color:colors.muted}}>{exportSummary}</Text></Panel>
      </>}
      {page==='privacy'&&<>
        <Heading colors={colors}>Личные переписки</Heading>
        <Panel colors={colors}><Text style={{color:colors.muted}}>Доступ по серверным правилам участников диалога. Это не означает сквозное шифрование.</Text></Panel>
        <Heading colors={colors}>Удаление аккаунта</Heading>
        <Panel colors={colors}><Text style={{color:colors.muted}}>Удаление необратимо. Отправленные сообщения останутся у собеседников от имени «Удалённый пользователь».</Text>
          <TextInput secureTextEntry value={deletePassword} onChangeText={setDeletePassword} placeholder="Текущий пароль" placeholderTextColor={colors.muted} style={{color:colors.text,borderWidth:1,borderColor:colors.line,borderRadius:12,padding:13}}/>
          <SmallButton colors={colors} danger disabled={working||!deletePassword} label="Удалить аккаунт навсегда" onPress={()=>Alert.alert('Удалить аккаунт навсегда?','Отменить удаление будет невозможно.',[{text:'Отмена',style:'cancel'},{text:'Удалить',style:'destructive',onPress:()=>void deleteAccount()}])}/>
        </Panel>
      </>}
      {page==='about'&&<Panel colors={colors}><Text style={{fontWeight:'800',fontSize:21,color:colors.text}}>Connect Messenger</Text><Text style={{color:colors.text}}>Эталонное PWA: версия {PWA_VERSION}</Text><Text style={{color:colors.text}}>Android-клиент: Connect Native (перенос в процессе)</Text><Text style={{color:colors.muted}}>Разработчики: Алина и Кирилл</Text><Text style={{color:colors.muted}}>Мессенджер для личного общения.</Text></Panel>}
      {page==='home'&&<SmallButton colors={colors} label={profileEdit?'Закрыть редактирование профиля':'Редактировать мой профиль'} onPress={()=>setProfileEdit(v=>!v)}/>}
      {page==='home'&&profileEdit&&<Panel colors={colors}>
        <TextInput style={{color:colors.text,borderWidth:1,borderColor:colors.line,borderRadius:12,padding:12}} placeholder="Имя" placeholderTextColor={colors.muted} maxLength={60} value={newName} onChangeText={setNewName}/>
        <TextInput style={{color:colors.text,borderWidth:1,borderColor:colors.line,borderRadius:12,padding:12,minHeight:80}} placeholder="О себе" placeholderTextColor={colors.muted} maxLength={160} value={newBio} onChangeText={setNewBio} multiline/>
        <SmallButton label="Изменить фотографию профиля" onPress={()=>void chooseAvatar()} colors={colors} disabled={working}/>
        <SmallButton label="Сохранить профиль" onPress={()=>void saveProfile()} colors={colors} disabled={working||!newName.trim()}/>
      </Panel>}
      {!!notices&&<Text accessibilityRole="alert" style={{marginTop:14,color:colors.accent,fontSize:13}}>{notices}</Text>}
      {working&&<ActivityIndicator color={colors.accent} style={{marginTop:12}}/>}
    </ScrollView>
    <ConnectNativeSonicRunner visible={gameOpen} colors={colors} onClose={()=>setGameOpen(false)}/>
    <ConnectNativeAvatarCropper source={cropAsset} colors={colors} busy={working} onClose={()=>setCropAsset(null)} onSave={saveCroppedAvatar}/>
  </View>;
}
