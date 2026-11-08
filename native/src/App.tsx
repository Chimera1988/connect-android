import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Image, KeyboardAvoidingView,
  Modal, Platform, Pressable, ScrollView, StatusBar as AndroidStatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Session } from '@supabase/supabase-js';
import { configured, db, mediaUrl, type Conversation, type Message, type Profile } from './backend';
import type {Palette} from './theme';
import {useConnectNativeAppearance} from './ConnectNativeAppearance';
import ConnectNativeSettings from './ConnectNativeSettings';
import ConnectNativeChat from './ConnectNativeChat';
import ConnectNativeCalls from './ConnectNativeCalls';
import {useConnectNativeReadSync} from './ConnectNativeReadSync';
import {useConnectNativeMissedCalls} from './ConnectNativeMissedCalls';
import ConnectNativeMedia from './ConnectNativeMedia';
import {ConnectNativeMusicProvider,ConnectNativeMusicMiniPlayer,ConnectNativeNowListening,useConnectNativeMusic} from './ConnectNativeMusic';
import {useConnectNativeVoice,ConnectNativeVoicePanel} from './ConnectNativeVoice';
import {subscribeSystemTelecom} from './ConnectNativeTelecom';
import type { MediaKind } from './nativeMediaUtils';
import {subscribeNativePush,disableNativePush,dismissChatPush,setVisibleConversation,type NativePushDestination} from './ConnectNativePush';
import ConnectNativeSoundSettings from './ConnectNativeSoundSettings';
import ConnectNativeGlass,{glassColor} from './ConnectNativeGlass';
import * as SecureStore from 'expo-secure-store';
import ConnectNativeInvites,{hasInviteAdminAccess,type InvitationMode} from './ConnectNativeInvites';
import {useConnectNativeInbox} from './ConnectNativeInbox';

type Tab = 'chats' | 'contacts' | 'calls' | 'settings';
type Screen = {kind:'tab'} | {kind:'chat';conversation:Conversation;peer:Profile} | {kind:'profile';profile:Profile} | {kind:'media'; profile:Profile; mediaKind: MediaKind};
const pad = (x:number)=>x<10?'0'+x:''+x;
const time = (v:string) => {const d=new Date(v);return Number.isNaN(d.getTime())?'':`${pad(d.getHours())}:${pad(d.getMinutes())}`;};
function textOf(message:Message){
  if(message.deleted_at)return 'Сообщение удалено';
  if(message.body?.startsWith('[[connect-album:')&&message.body.endsWith(']]')){
    try{const items:unknown=JSON.parse(message.body.slice('[[connect-album:'.length,-2));
      if(Array.isArray(items)&&items.length>=1&&items.length<=20)return `Альбом (${items.length})`;
    }catch{/* malformed album */}
  }
  if(message.body?.startsWith('[[connect-sticker:')||message.body?.startsWith('[[connect-custom-sticker:'))return 'Стикер';
  if(message.attachment_kind==='video' && /^connect-video-note-\d+\.(?:mp4|webm)$/i.test(message.attachment_name||''))return 'Видеокружок';
  if(message.attachment_kind==='image' && /^sticker-\d+\.(?:png|webp|gif|jpe?g)$/i.test(message.attachment_name||''))return 'Стикер';
  if(message.body?.startsWith('[['))return 'Стикер или вложение';
  if(message.attachment_name)return message.attachment_kind==='audio'?'🎤 Голосовое сообщение':'📎 '+message.attachment_name;
  return message.body || 'Вложение';
}
function Btn({icon,label,onPress,colors,disabled}:{icon:keyof typeof Ionicons.glyphMap;label?:string;onPress:()=>void;colors:Palette;disabled?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label || icon} disabled={disabled} onPress={onPress}
    style={({pressed})=>({padding:9,opacity:disabled ? .4 : pressed ? .6 : 1})}><Ionicons name={icon} size={23} color={colors.accent}/></Pressable>;
}
function Avatar({name,url,colors,size=46}:{name:string;url?:string;colors:Palette;size?:number}){
  return <View style={{width:size,height:size,borderRadius:size/2,borderWidth:1.5,borderColor:colors.accent,backgroundColor:colors.elevated,alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
    {url?<Image source={{uri:url}} style={{width:size,height:size}}/>:<Text style={{fontWeight:'700',color:colors.text,fontSize:size*.4}}>{(name||'C').slice(0,1).toUpperCase()}</Text>}
  </View>;
}
function Label({children,colors,muted=false,size=14}:{children:React.ReactNode;colors:Palette;muted?:boolean;size?:number}){
  return <Text style={{color:muted?colors.muted:colors.text,fontSize:size}}>{children}</Text>;
}
function AppMain(){
  const [session,setSession]=useState<Session|null>(null);
  const [initializing,setInitializing]=useState(true);
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [authBusy,setAuthBusy]=useState(false);
  const [inviteMode,setInviteMode]=useState<InvitationMode|null>(null);
  const [inviteAdmin,setInviteAdmin]=useState(false);
  const [tab,setTab]=useState<Tab>('chats');const [screen,setScreen]=useState<Screen>({kind:'tab'});
  const appearance=useConnectNativeAppearance();
  const colors=appearance.colors;
  const theme=appearance.prefs.scene;
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [avatars,setAvatars]=useState<Record<string,string>>({});
  const [conversations,setConversations]=useState<Conversation[]>([]);
  // CONNECT_NATIVE_PWA_PHASE4_HISTORY: local clear state belongs to the signed-in user.
  const [clearedChats,setClearedChats]=useState<Record<string,string>>({});
  const [clearedReady,setClearedReady]=useState(false);
  const [search,setSearch]=useState('');
  const [notice,setNotice]=useState('');
  const [pushDestination,setPushDestination]=useState<NativePushDestination|null>(null);
  const ownId=session?.user.id||'';
  useConnectNativeReadSync(ownId);
  const missedCalls=useConnectNativeMissedCalls(ownId,tab==='calls'&&screen.kind==='tab');
  const music=useConnectNativeMusic();
  useEffect(()=>{music.setUser(ownId);},[ownId,music.setUser]);
  useEffect(()=>{
    let alive=true;
    setClearedChats({});setClearedReady(false);
    if(!ownId){setClearedReady(true);return()=>{alive=false;};}
    void SecureStore.getItemAsync('connect-native-cleared-chats:'+ownId).then(raw=>{
      if(!alive||!raw)return;
      const parsed:unknown=JSON.parse(raw);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return;
      const restored:Record<string,string>={};
      for(const [key,value] of Object.entries(parsed)){
        if(/^[0-9a-f-]{36}$/i.test(key)&&typeof value==='string'&&Number.isFinite(Date.parse(value)))restored[key]=value;
      }
      setClearedChats(restored);
    }).catch(()=>{}).finally(()=>{if(alive)setClearedReady(true)});
    return()=>{alive=false;};
  },[ownId]);
  useEffect(()=>{
    let alive=true;
    if(!ownId){setInviteAdmin(false);return;}
    void hasInviteAdminAccess().then(allowed=>{if(alive)setInviteAdmin(allowed);});
    return()=>{alive=false;};
  },[ownId]);
  const voice=useConnectNativeVoice(ownId,profiles);
  const voiceRef=useRef(voice);
  voiceRef.current=voice;
  useEffect(()=>{
    if(!ownId)return;
    return subscribeSystemTelecom((action,callId)=>{
      if(action==='answer'){
        void voiceRef.current.checkIncoming(callId).then(()=>voiceRef.current.accept());
      }else if(action==='mute'||action==='unmute'){
        if(voiceRef.current.shown?.id===callId)
          voiceRef.current.setMicMuted(action==='mute');
      }else{
        if(voiceRef.current.shown?.id===callId)
          void voiceRef.current.finish(voiceRef.current.phase==='incoming'?'decline':'hangup');
      }
    });
  },[ownId]);
  const fetchCounter=useRef(0);

  useEffect(()=>{
    let alive=true;
    void db.auth.getSession().then(({data})=>{if(alive){setSession(data.session);setInitializing(false);}}).catch(()=>setInitializing(false));
    const {data:{subscription}}=db.auth.onAuthStateChange((_event,next)=>{if(alive)setSession(next);});
    return ()=>{alive=false;subscription.unsubscribe();};
  },[]);

  const loadDirectory=useCallback(async()=>{
    if(!ownId)return;
    const generation=++fetchCounter.current;
    const [p,c]=await Promise.all([
      db.from('profiles').select('id,display_name,bio,avatar_path,is_blocked').eq('is_blocked',false).limit(250),
      db.from('conversations').select('id,user_a,user_b,created_at').order('created_at',{ascending:false}).limit(400),
    ]);
    if(generation!==fetchCounter.current)return;
    if(p.error||c.error){setNotice('Ошибка соединения: '+(p.error?.message||c.error?.message));return;}
    const people=(p.data||[]) as Profile[];
    setProfiles(people);setConversations((c.data||[]) as Conversation[]);
    const photos=await Promise.all(people.filter(x=>x.avatar_path).map(async x=>{
      const {data}=await db.storage.from('connect-avatars').createSignedUrl(x.avatar_path!,1800);
      return [x.id,data?.signedUrl?mediaUrl(data.signedUrl):''] as const;
    }));
    if(generation===fetchCounter.current)setAvatars(Object.fromEntries(photos));
  },[ownId]);

  useEffect(()=>{
    if(!ownId){setProfiles([]);setConversations([]);return;}
    void loadDirectory();
    const id=setInterval(()=>{void loadDirectory();},14000);
    return()=>clearInterval(id);
  },[ownId,loadDirectory]);

  useEffect(()=>{
    if(!ownId)return;
    return subscribeNativePush(ownId,setPushDestination,setNotice);
  },[ownId]);
  useEffect(()=>{
    if(!pushDestination||!ownId)return;
    if(pushDestination.kind==='call'){
      setScreen({kind:'tab'});setTab('calls');
      void voice.checkIncoming(pushDestination.callId);
      setPushDestination(null);return;
    }
    const chat=conversations.find(c=>c.id===pushDestination.conversationId);
    if(!chat)return;
    const peerId=chat.user_a===ownId?chat.user_b:chat.user_a;
    const peer=profiles.find(p=>p.id===peerId);
    if(!peer)return;
    setScreen({kind:'chat',conversation:chat,peer});setTab('chats');setPushDestination(null);
    void dismissChatPush(chat.id);
  },[pushDestination,ownId,conversations,profiles]);
  useEffect(()=>{
    const sync=(status:string)=>{
      const visible=status==='active' && screen.kind==='chat'?screen.conversation.id:null;
      setVisibleConversation(visible);
      if(visible)void dismissChatPush(visible);
    };
    sync(AppState.currentState ?? 'background');
    const sub=AppState.addEventListener('change',sync);
    return()=>{sub.remove();setVisibleConversation(null);};
  },[screen]);

  const inbox=useConnectNativeInbox(ownId,conversations);
  const chats=useMemo(()=>conversations.map(c=>({conversation:c,peer:profiles.find(p=>p.id===(c.user_a===ownId?c.user_b:c.user_a))})).filter(x=>x.peer && !x.peer.is_blocked) as {conversation:Conversation;peer:Profile}[],[conversations,profiles,ownId]);
  const orderedChats=useMemo(()=>[...chats].sort((a,b)=>{
    const da=inbox[a.conversation.id]?.last?.created_at||a.conversation.created_at;
    const db=inbox[b.conversation.id]?.last?.created_at||b.conversation.created_at;
    return Date.parse(db)-Date.parse(da);
  }),[chats,inbox]);
  const displayChats=useMemo(()=>clearedReady?orderedChats.filter(item=>{
    const cleared=clearedChats[item.conversation.id];
    const newest=inbox[item.conversation.id]?.last;
    return !cleared || Boolean(newest && newest.created_at>cleared);
  }):[],[clearedReady,orderedChats,clearedChats,inbox]);
  const unreadTotal=useMemo(()=>displayChats.reduce((sum,item)=>sum+(inbox[item.conversation.id]?.unread||0),0),[displayChats,inbox]);
  async function login(){if(!email.trim()||!password)return;
    setAuthBusy(true);setNotice('');
    const {error}=await db.auth.signInWithPassword({email:email.trim(),password});
    setAuthBusy(false);if(error)setNotice(error.message);else setPassword('');
  }
  async function openPerson(person:Profile){
    if(!ownId||person.id===ownId){setScreen({kind:'profile',profile:person});return;}
    let chat=conversations.find(x=>x.user_a===person.id||x.user_b===person.id);
    if(!chat){const [user_a,user_b]=[ownId,person.id].sort();const result=await db.from('conversations').upsert({user_a,user_b},{onConflict:'user_a,user_b'}).select('id,user_a,user_b,created_at').single();
      if(result.error||!result.data){setNotice(result.error?.message||'Не удалось начать чат');return;}
      chat=result.data as Conversation;setConversations(old=>[chat!,...old]);
    }
    setSearch('');setScreen({kind:'chat',conversation:chat,peer:person});
  }
  async function clearConversation(id:string){
    if(!ownId)return;
    const next={...clearedChats,[id]:new Date().toISOString()};
    try{
      await SecureStore.setItemAsync('connect-native-cleared-chats:'+ownId,JSON.stringify(next));
      setClearedChats(next);setScreen({kind:'tab'});setTab('chats');
      setNotice('Переписка скрыта только на этом устройстве');
    }catch(e){setNotice('Не удалось очистить переписку: '+(e instanceof Error?e.message:String(e)));}
  }
  function confirmClearConversation(id:string,person:string){
    Alert.alert('Удалить переписку?',`Переписка с ${person} будет скрыта только на этом устройстве. У собеседника сообщения останутся.`,[
      {text:'Отмена',style:'cancel'},
      {text:'Удалить',style:'destructive',onPress:()=>void clearConversation(id)},
    ]);
  }
  async function logout(){music.close();await disableNativePush();await db.auth.signOut();setClearedChats({});setScreen({kind:'tab'});setTab('chats');}
  const own=profiles.find(p=>p.id===ownId);
  const s=makeStyles(colors);
  if(initializing)return <View style={[s.root,s.center]}><ActivityIndicator color={colors.accent}/></View>;
  if(!configured)return <View style={[s.root,s.center,s.pad]}><Label colors={colors}>Новый клиент пока не настроен: добавь публичный ключ Supabase в конфигурацию сборки.</Label></View>;
  if(!session)return <View style={[s.root,s.center,s.pad]}><ConnectNativeGlass colors={colors} theme={theme}/>
    <Ionicons name="chatbubbles-outline" size={70} color={colors.accent}/><Text style={s.loginTitle}>Connect</Text>
    <Text style={s.subtitle}>Вход в нативное приложение</Text>
    <TextInput style={s.field} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="Почта" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail}/>
    <TextInput style={s.field} secureTextEntry placeholder="Пароль" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword}/>
    <Pressable style={s.mainAction} onPress={()=>void login()} disabled={authBusy}><Text style={s.actionText}>{authBusy?'Вход…':'Войти'}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={()=>setInviteMode('register')} style={{marginTop:18,paddingVertical:12,paddingHorizontal:15}}>
      <Text style={{color:colors.accent,fontSize:15,fontWeight:'700'}}>У меня есть код приглашения</Text>
    </Pressable>
    {!!notice&&<Text style={s.error}>{notice}</Text>}
    <ConnectNativeInvites visible={inviteMode==='register'} mode="register" colors={colors} onClose={()=>setInviteMode(null)}/>
  </View>;

  function tabButton(which:Tab,icon:keyof typeof Ionicons.glyphMap,title:string){const active=tab===which;
    return <Pressable onPress={()=>{setScreen({kind:'tab'});setTab(which);}} style={[s.tab,active&&s.tabActive]} accessibilityRole="tab" accessibilityState={{selected:active}}>
      <Ionicons name={icon} size={23} color={active?colors.accent:colors.muted}/>
      {which==='chats'&&unreadTotal>0&&<View style={{position:'absolute',top:-7,right:'20%',backgroundColor:colors.accent,borderRadius:10,minWidth:18,height:18,paddingHorizontal:4,alignItems:'center',justifyContent:'center'}}>
        <Text style={{fontSize:10,color:colors.bg,fontWeight:'800'}}>{unreadTotal>99?'99+':unreadTotal}</Text>
      </View>}
      {which==='calls'&&missedCalls.count>0&&<View style={{position:'absolute',top:-7,right:'20%',backgroundColor:colors.accent,borderRadius:10,minWidth:18,height:18,paddingHorizontal:4,alignItems:'center',justifyContent:'center'}}>
        <Text style={{fontSize:10,color:colors.bg,fontWeight:'800'}}>{missedCalls.count>99?'99+':missedCalls.count}</Text>
      </View>}
      <Text style={[s.tabLabel,{color:active?colors.accent:colors.muted}]}>{title}</Text>
    </Pressable>;
  }
  function content(){
    if(screen.kind==='chat')return <ConnectNativeChat key={screen.conversation.id}
      conversation={screen.conversation} peer={screen.peer} ownerId={ownId} profiles={profiles}
      avatarUrl={avatars[screen.peer.id]} colors={colors}
      wallpaperUri={appearance.prefs.wallpaper} enabledPacks={appearance.prefs.enabledPacks}
      clearedAt={clearedChats[screen.conversation.id]||null}
      onClearChat={()=>confirmClearConversation(screen.conversation.id,screen.peer.display_name)}
      onBack={()=>setScreen({kind:'tab'})}
      onOpenProfile={()=>setScreen({kind:'profile',profile:screen.peer})}
      onCall={()=>void voice.dial(screen.conversation.id,screen.peer.id,screen.peer.display_name)} />;
    if(screen.kind==='media')return <ConnectNativeMedia key={`${screen.profile.id}:${screen.mediaKind}`}
      ownerId={screen.profile.id} owner={screen.profile.id===ownId} kind={screen.mediaKind}
      colors={colors} onBack={()=>setScreen({kind:'profile',profile:screen.profile})}/>;
    if(screen.kind==='profile')return <View style={{flex:1}}>
      <View style={s.top}><Btn icon="chevron-back" colors={colors} onPress={()=>setScreen({kind:'tab'})}/><Text style={s.title}>Профиль</Text></View>
      <ScrollView contentContainerStyle={{padding:18,alignItems:'center',gap:12}}>
        <Avatar name={screen.profile.display_name} url={avatars[screen.profile.id]} colors={colors} size={90}/>
        <Text style={[s.title,{fontSize:23}]}>{screen.profile.display_name}</Text>
        <Text style={s.subtitle}>{screen.profile.bio||'Информация о себе не указана'}</Text>
        <ConnectNativeNowListening profileId={screen.profile.id} colors={colors}/>
        {screen.profile.id!==ownId&&<Pressable style={s.mainAction} onPress={()=>void openPerson(screen.profile)}><Text style={s.actionText}>Написать сообщение</Text></Pressable>}
        <View style={{width:'100%',gap:10,marginTop:15}}>
          {([{kind:'photos',title:'Фото',icon:'images-outline'}, {kind:'videos',title:'Видео',icon:'videocam-outline'}, {kind:'music',title:'Музыка',icon:'musical-notes-outline'}] as const).map(m=><Pressable key={m.kind}
            onPress={()=>setScreen({kind:'media',profile:screen.profile,mediaKind:m.kind})}
            style={[s.entry,{width:'100%'}]} accessibilityRole="button">
            <Ionicons name={m.icon} size={24} color={colors.accent}/>
            <Text style={[s.entryTitle,{flex:1}]}>{m.title}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted}/>
          </Pressable>)}
        </View>
      </ScrollView>
    </View>;
    if(tab==='settings')return <ConnectNativeSettings
      owner={own||null} email={session?.user.email||''} colors={colors}
      appearance={appearance} admin={inviteAdmin}
      onInvite={()=>setInviteMode('admin')}
      onProfile={()=>{if(own)setScreen({kind:'profile',profile:own});}}
      onLogout={()=>void logout()} onProfileSaved={loadDirectory}/>;
    if(tab==='calls')return <ConnectNativeCalls ownerId={ownId} profiles={profiles} avatars={avatars} colors={colors}
      onDial={(conversationId,peer)=>void voice.dial(conversationId,peer.id,peer.display_name)}/>;
    if(tab==='contacts')return <FlatList data={profiles.filter(p=>p.id!==ownId&&p.display_name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))} keyExtractor={x=>x.id} contentContainerStyle={[s.pad,{gap:5}]} ListHeaderComponent={<><Text style={s.title}>Контакты</Text><TextInput style={[s.field,{marginVertical:14}]} placeholder="Найти пользователя" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch}/></>} renderItem={({item})=><Pressable style={s.entry} onPress={()=>void openPerson(item)}><Avatar name={item.display_name} url={avatars[item.id]} colors={colors}/><Text style={[s.entryTitle,{flex:1}]}>{item.display_name}</Text><Ionicons name="chatbubble-outline" color={colors.accent} size={20}/></Pressable>}/>;
    return <FlatList data={displayChats.filter(item=>{
      const q=search.trim().toLocaleLowerCase('ru-RU');
      const last=inbox[item.conversation.id]?.last;
      return !q||item.peer.display_name.toLocaleLowerCase('ru-RU').includes(q)||
        (last&&textOf(last).toLocaleLowerCase('ru-RU').includes(q));
    })} keyExtractor={x=>x.conversation.id} contentContainerStyle={[s.pad,{gap:7}]}
      ListHeaderComponent={<>
        <View style={{flexDirection:'row',alignItems:'center',gap:11,paddingTop:8,paddingBottom:14}}>
          <Image source={require('../assets/connect-icon.png')} style={{width:42,height:42,borderRadius:12}}/>
          <Text style={{fontSize:28,fontWeight:'800',color:colors.text,letterSpacing:-0.8,flex:1}}>Connect</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Новая переписка" onPress={()=>{setSearch('');setTab('contacts');}}
            style={{width:43,height:43,borderRadius:15,backgroundColor:glassColor(colors.surface,.8),borderWidth:1,borderColor:glassColor(colors.text,.16),alignItems:'center',justifyContent:'center'}}>
            <Ionicons name="create-outline" size={23} color={colors.accent}/>
          </Pressable>
        </View>
        <View style={{flexDirection:'row',alignItems:'center',gap:9,marginBottom:13}}>
          <Text style={s.title}>Чаты</Text>
          <View style={{borderRadius:12,backgroundColor:glassColor(colors.surface,.85),paddingHorizontal:8,paddingVertical:3}}>
            <Text style={{fontSize:12,fontWeight:'700',color:colors.accent}}>{displayChats.length}</Text>
          </View>
        </View>
        <View style={[s.field,{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:0,marginBottom:13}]}>
          <Ionicons name="search" size={20} color={colors.muted}/>
          <TextInput style={{flex:1,height:44,color:colors.text,fontSize:15}} placeholder="Поиск в Connect" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch}/>
          {!!search&&<Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск" onPress={()=>setSearch('')}><Ionicons name="close-circle" color={colors.muted} size={20}/></Pressable>}
        </View>
      </>}
      ListEmptyComponent={<Text style={s.subtitle}>{clearedReady?'Нет подходящих переписок.':'Загружаем чаты…'}</Text>}
      renderItem={({item})=>{
        const summary=inbox[item.conversation.id];
        const last=summary?.last;
        const unread=summary?.unread||0;
        return <Pressable accessibilityRole="button" accessibilityLabel={item.peer.display_name+(unread?' · непрочитано: '+unread:'')}
          style={[s.entry,{minHeight:78,paddingVertical:12}]}
          onLongPress={()=>confirmClearConversation(item.conversation.id,item.peer.display_name)}
          onPress={()=>{setSearch('');setScreen({kind:'chat',conversation:item.conversation,peer:item.peer});}}>
          <Avatar name={item.peer.display_name} url={avatars[item.peer.id]} colors={colors} size={49}/>
          <View style={{flex:1,gap:5}}>
            <Text numberOfLines={1} style={s.entryTitle}>{item.peer.display_name}</Text>
            <Text numberOfLines={1} style={[s.subtitle,{fontSize:13,color:unread?colors.text:colors.muted,fontWeight:unread?'600':'400'}]}>
              {last?(last.sender_id===ownId?'Вы: ':'')+textOf(last):'Нет сообщений'}
            </Text>
          </View>
          <View style={{alignItems:'flex-end',gap:7}}>
            <Text style={[s.subtitle,{fontSize:10}]}>{time(last?.created_at||item.conversation.created_at)}</Text>
            {unread>0?<View style={{backgroundColor:colors.accent,minWidth:23,height:23,borderRadius:12,paddingHorizontal:5,alignItems:'center',justifyContent:'center'}}>
              <Text style={{color:colors.bg,fontWeight:'800',fontSize:11}}>{unread>99?'99+':unread}</Text>
            </View>:<Ionicons name="chevron-forward" size={18} color={colors.muted}/>}
          </View>
        </Pressable>;
      }}/>;
  }
  return <View style={s.root}><ConnectNativeGlass colors={colors} theme={theme}/><StatusBar style={appearance.prefs.mode==='light'?'dark':'light'}/>
    <View style={{flex:1}}>{content()}</View>
    <ConnectNativeMusicMiniPlayer colors={colors} onOpen={id=>{
      const profile=profiles.find(p=>p.id===id);
      if(profile)setScreen({kind:'media',profile,mediaKind:'music'});
    }}/>
    {screen.kind==='tab'&&<View style={s.bottom}>
      {tabButton('chats','chatbubbles-outline','Чаты')}
      {tabButton('contacts','people-outline','Контакты')}
      {tabButton('calls','call-outline','Звонки')}
      {tabButton('settings','settings-outline','Настройки')}
    </View>}
    <ConnectNativeInvites visible={inviteMode==='admin'} mode="admin" colors={colors} onClose={()=>setInviteMode(null)}/>
    <ConnectNativeVoicePanel voice={voice} colors={colors}/>
    {!!notice&&<Pressable style={s.toast} onPress={()=>setNotice('')}><Text style={{color:colors.text}}>{notice}</Text><Ionicons name="close" color={colors.text} size={15}/></Pressable>}
  </View>;
}
function makeStyles(p:Palette){return StyleSheet.create({
  root:{flex:1,backgroundColor:p.bg},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12},pad:{padding:16},
  loginTitle:{fontSize:36,fontWeight:'800',color:p.text,marginTop:8},title:{fontSize:26,fontWeight:'700',color:p.text},
  subtitle:{fontSize:12,color:p.muted,lineHeight:17},headerLabel:{color:p.muted,fontSize:12,letterSpacing:1,textTransform:'uppercase'},
  field:{color:p.text,borderWidth:1,borderColor:glassColor(p.text,.15),backgroundColor:glassColor(p.surface,.77),borderRadius:15,paddingHorizontal:15,paddingVertical:12,fontSize:16,minHeight:48,width:'100%'},
  mainAction:{backgroundColor:p.accent,borderRadius:16,padding:15,alignItems:'center',justifyContent:'center',minWidth:170,marginTop:8},
  actionText:{color:'#051a22',fontWeight:'800',fontSize:15},error:{color:p.danger,fontSize:13},
  top:{minHeight:60,flexDirection:'row',alignItems:'center',paddingHorizontal:8,borderBottomWidth:.5,borderColor:p.line},
  bubble:{maxWidth:'85%',borderWidth:1,borderRadius:18,paddingHorizontal:12,paddingVertical:9},
  compose:{flexDirection:'row',alignItems:'center',paddingHorizontal:13,paddingVertical:10,borderTopWidth:.6,borderColor:p.line},
  composeInput:{flex:1,backgroundColor:p.surface,borderRadius:16,color:p.text,paddingHorizontal:14,paddingVertical:11,maxHeight:115,fontSize:16},
  bottom:{flexDirection:'row',justifyContent:'space-around',padding:6,marginHorizontal:13,marginBottom:10,minHeight:67,borderWidth:1,borderColor:glassColor(p.text,.17),backgroundColor:glassColor(p.surface,.85),borderRadius:25,overflow:'hidden'},
  tab:{alignItems:'center',justifyContent:'center',flex:1,gap:3,paddingVertical:5,borderRadius:20,borderWidth:1,borderColor:'transparent'},tabActive:{backgroundColor:glassColor(p.accent,.15),borderColor:glassColor(p.accent,.26)},tabLabel:{fontSize:10,fontWeight:'600'},
  entry:{flexDirection:'row',gap:13,alignItems:'center',padding:11,borderWidth:1,borderColor:glassColor(p.text,.14),backgroundColor:glassColor(p.surface,.82),borderRadius:20,minHeight:66},
  entryTitle:{fontWeight:'700',fontSize:15,color:p.text},
  colorGrid:{flexDirection:'row',flexWrap:'wrap',gap:9,marginTop:13},
  colorChip:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:11,paddingVertical:11,borderWidth:1,borderColor:glassColor(p.text,.14),backgroundColor:glassColor(p.surface,.65),borderRadius:14},
  toast:{position:'absolute',bottom:87,left:15,right:15,padding:14,borderWidth:1,borderColor:p.danger,backgroundColor:p.elevated,borderRadius:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
});}
export default function App(){return <SafeAreaProvider><SafeAreaView style={{flex:1,backgroundColor:'#07121b'}} edges={['top','bottom']}><ConnectNativeMusicProvider><AppMain/></ConnectNativeMusicProvider></SafeAreaView></SafeAreaProvider>;}
