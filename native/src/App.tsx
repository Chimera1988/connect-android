import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView,
  Modal, Platform, Pressable, ScrollView, StatusBar as AndroidStatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Session } from '@supabase/supabase-js';
import { configured, db, mediaUrl, MESSAGE_COLUMNS, type Call, type Conversation, type Message, type Profile } from './backend';
import { palettes, themeNames, type Palette, type ThemeName } from './theme';

type Tab = 'chats' | 'contacts' | 'calls' | 'settings';
type Screen = {kind:'tab'} | {kind:'chat';conversation:Conversation;peer:Profile} | {kind:'profile';profile:Profile};
const pad = (x:number)=>x<10?'0'+x:''+x;
const time = (v:string) => {const d=new Date(v);return Number.isNaN(d.getTime())?'':`${pad(d.getHours())}:${pad(d.getMinutes())}`;};
function textOf(message:Message){
  if(message.deleted_at)return 'Сообщение удалено';
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
  const [tab,setTab]=useState<Tab>('chats');const [screen,setScreen]=useState<Screen>({kind:'tab'});
  const [theme,setTheme]=useState<ThemeName>('waves');
  const colors=palettes[theme];
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [avatars,setAvatars]=useState<Record<string,string>>({});
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [messages,setMessages]=useState<Message[]>([]);
  const [calls,setCalls]=useState<Call[]>([]);
  const [draft,setDraft]=useState('');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [sending,setSending]=useState(false);
  const [notice,setNotice]=useState('');
  const listRef=useRef<FlatList<Message>>(null);
  const ownId=session?.user.id||'';
  const actualChat=screen.kind==='chat'?screen:null;
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

  const loadMessages=useCallback(async(chatId:string)=>{
    if(!ownId)return;
    const {data,error}=await db.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id',chatId).order('created_at',{ascending:false}).limit(300);
    if(error){setNotice('Не удалось открыть переписку: '+error.message);return;}
    setMessages(((data||[]) as Message[]).reverse());
  },[ownId]);

  const loadCalls=useCallback(async()=>{
    if(!ownId)return;
    const {data,error}=await db.from('connect_calls').select('id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at')
      .or(`caller_id.eq.${ownId},callee_id.eq.${ownId}`).order('created_at',{ascending:false}).limit(150);
    if(!error)setCalls((data||[]) as Call[]);
  },[ownId]);

  useEffect(()=>{
    if(!ownId){setProfiles([]);setConversations([]);setCalls([]);return;}
    void loadDirectory();void loadCalls();
    const id=setInterval(()=>{void loadDirectory();},14000);
    return()=>clearInterval(id);
  },[ownId,loadDirectory,loadCalls]);
  useEffect(()=>{
    if(!actualChat)return;
    const id=actualChat.conversation.id;
    void loadMessages(id);
    const poll=setInterval(()=>{void loadMessages(id);},4500);
    return()=>clearInterval(poll);
  },[actualChat?.conversation.id,loadMessages]);
  useEffect(()=>{if(tab!=='calls'||screen.kind!=='tab')return;void loadCalls();const poll=setInterval(()=>void loadCalls(),12000);return()=>clearInterval(poll);},[tab,screen.kind,loadCalls]);

  const chats=useMemo(()=>conversations.map(c=>({conversation:c,peer:profiles.find(p=>p.id===(c.user_a===ownId?c.user_b:c.user_a))})).filter(x=>x.peer && !x.peer.is_blocked) as {conversation:Conversation;peer:Profile}[],[conversations,profiles,ownId]);
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
    setSearch('');setMessages([]);setScreen({kind:'chat',conversation:chat,peer:person});
  }
  async function send(){if(!actualChat||!ownId||!draft.trim()||sending)return;
    const text=draft.trim();setSending(true);setDraft('');
    const {error}=await db.from('messages').insert({conversation_id:actualChat.conversation.id,sender_id:ownId,body:text});
    setSending(false);if(error){setDraft(text);setNotice(error.message);}else await loadMessages(actualChat.conversation.id);
  }
  async function logout(){await db.auth.signOut();setScreen({kind:'tab'});setTab('chats');}
  const own=profiles.find(p=>p.id===ownId);
  const s=makeStyles(colors);
  if(initializing)return <View style={[s.root,s.center]}><ActivityIndicator color={colors.accent}/></View>;
  if(!configured)return <View style={[s.root,s.center,s.pad]}><Label colors={colors}>Новый клиент пока не настроен: добавь публичный ключ Supabase в конфигурацию сборки.</Label></View>;
  if(!session)return <View style={[s.root,s.center,s.pad]}>
    <Ionicons name="chatbubbles-outline" size={70} color={colors.accent}/><Text style={s.loginTitle}>Connect</Text>
    <Text style={s.subtitle}>Вход в нативное приложение</Text>
    <TextInput style={s.field} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="Почта" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail}/>
    <TextInput style={s.field} secureTextEntry placeholder="Пароль" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword}/>
    <Pressable style={s.mainAction} onPress={()=>void login()} disabled={authBusy}><Text style={s.actionText}>{authBusy?'Вход…':'Войти'}</Text></Pressable>
    {!!notice&&<Text style={s.error}>{notice}</Text>}
  </View>;

  function tabButton(which:Tab,icon:keyof typeof Ionicons.glyphMap,title:string){const active=tab===which;
    return <Pressable onPress={()=>{setScreen({kind:'tab'});setTab(which);}} style={s.tab} accessibilityRole="tab" accessibilityState={{selected:active}}>
      <Ionicons name={icon} size={23} color={active?colors.accent:colors.muted}/><Text style={[s.tabLabel,{color:active?colors.accent:colors.muted}]}>{title}</Text>
    </Pressable>;
  }
  function content(){
    if(screen.kind==='chat')return <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
      <View style={s.top}><Btn icon="chevron-back" colors={colors} onPress={()=>setScreen({kind:'tab'})}/>
        <Pressable style={{flex:1}} onPress={()=>setScreen({kind:'profile',profile:screen.peer})}>
          <Text style={s.title}>{screen.peer.display_name}</Text><Text style={s.subtitle}>Connect · личный чат</Text>
        </Pressable><Btn icon="call-outline" colors={colors} onPress={()=>Alert.alert('Аудиозвонки','Нативный WebRTC и Android Telecom пока не подключены. Старый APK продолжает работать.')} />
      </View>
      <FlatList ref={listRef} data={messages} keyExtractor={x=>x.id} contentContainerStyle={{padding:15,gap:9,paddingBottom:20}} onContentSizeChange={()=>listRef.current?.scrollToEnd({animated:false})}
        renderItem={({item})=>{const mine=item.sender_id===ownId;return <View style={[s.bubble,{alignSelf:mine?'flex-end':'flex-start',backgroundColor:mine?colors.elevated:colors.surface,borderColor:mine?colors.accent:colors.line}]}> 
          <Text style={{color:colors.text,fontSize:15}}>{textOf(item)}</Text><Text style={{textAlign:'right',color:colors.muted,fontSize:10,marginTop:4}}>{time(item.created_at)}</Text>
        </View>;}}/>
      <View style={s.compose}><TextInput multiline value={draft} onChangeText={setDraft} style={s.composeInput} placeholder="Сообщение" placeholderTextColor={colors.muted}/>
        <Btn icon="send" label="Отправить сообщение" colors={colors} disabled={!draft.trim()||sending} onPress={()=>void send()}/>
      </View>
    </KeyboardAvoidingView>;
    if(screen.kind==='profile')return <View style={{flex:1}}>
      <View style={s.top}><Btn icon="chevron-back" colors={colors} onPress={()=>setScreen({kind:'tab'})}/><Text style={s.title}>Профиль</Text></View>
      <View style={s.center}><Avatar name={screen.profile.display_name} url={avatars[screen.profile.id]} colors={colors} size={90}/>
        <Text style={[s.title,{fontSize:23,marginTop:12}]}>{screen.profile.display_name}</Text><Text style={s.subtitle}>{screen.profile.bio||'Информация о себе не указана'}</Text>
        {screen.profile.id!==ownId&&<Pressable style={s.mainAction} onPress={()=>void openPerson(screen.profile)}><Text style={s.actionText}>Написать сообщение</Text></Pressable>}
      </View>
    </View>;
    if(tab==='settings')return <ScrollView style={{flex:1}} contentContainerStyle={s.pad}>
      <Text style={s.title}>Настройки</Text>
      <View style={[s.entry,{marginTop:19}]}><Avatar name={own?.display_name||'Connect'} url={avatars[ownId]} colors={colors}/><View style={{flex:1}}><Text style={s.entryTitle}>{own?.display_name||'Мой профиль'}</Text><Text style={s.subtitle}>{session?.user.email}</Text></View></View>
      <Text style={[s.headerLabel,{marginTop:25}]}>Оформление</Text>
      <View style={s.colorGrid}>{themeNames.map(item=><Pressable key={item.id} onPress={()=>setTheme(item.id)} style={[s.colorChip,{borderColor:theme===item.id?colors.accent:colors.line,backgroundColor:palettes[item.id].surface}]}>
        <View style={{width:10,height:10,borderRadius:5,backgroundColor:palettes[item.id].accent}}/><Text style={{color:theme===item.id?colors.text:colors.muted,fontSize:12}}>{item.name}</Text>
      </Pressable>)}</View>
      <Text style={[s.subtitle,{marginTop:22}]}>Звуки, разрешения, управление камерой и микрофоном перейдут в нативные настройки при подключении соответствующих модулей.</Text>
      <Pressable style={[s.mainAction,{backgroundColor:colors.elevated,marginTop:32}]} onPress={()=>void logout()}><Text style={s.actionText}>Выйти из аккаунта</Text></Pressable>
    </ScrollView>;
    if(tab==='calls')return <FlatList data={calls} keyExtractor={x=>x.id} contentContainerStyle={[s.pad,{gap:6}]} ListHeaderComponent={<Text style={[s.title,{marginBottom:14}]}>Звонки</Text>} ListEmptyComponent={<Label colors={colors} muted>История звонков пуста</Label>} renderItem={({item})=>{
      const peerId=item.caller_id===ownId?item.callee_id:item.caller_id;const peer=profiles.find(p=>p.id===peerId);return <View style={s.entry}><Avatar name={peer?.display_name||'Собеседник'} url={avatars[peerId]} colors={colors}/><View style={{flex:1}}><Text style={s.entryTitle}>{peer?.display_name||'Собеседник'}</Text>
        <Text style={s.subtitle}>{item.caller_id===ownId?'Исходящий':'Входящий'} · {item.status} · {time(item.created_at)}</Text></View></View>;
    }}/>
    if(tab==='contacts')return <FlatList data={profiles.filter(p=>p.id!==ownId&&p.display_name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))} keyExtractor={x=>x.id} contentContainerStyle={[s.pad,{gap:5}]} ListHeaderComponent={<><Text style={s.title}>Контакты</Text><TextInput style={[s.field,{marginVertical:14}]} placeholder="Найти пользователя" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch}/></>} renderItem={({item})=><Pressable style={s.entry} onPress={()=>void openPerson(item)}><Avatar name={item.display_name} url={avatars[item.id]} colors={colors}/><Text style={[s.entryTitle,{flex:1}]}>{item.display_name}</Text><Ionicons name="chatbubble-outline" color={colors.accent} size={20}/></Pressable>}/>;
    return <FlatList data={chats.filter(x=>x.peer.display_name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))} keyExtractor={x=>x.conversation.id} contentContainerStyle={[s.pad,{gap:5}]} ListHeaderComponent={<><Text style={s.title}>Чаты</Text><TextInput style={[s.field,{marginVertical:14}]} placeholder="Поиск по контактам" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch}/></>} ListEmptyComponent={<Text style={s.subtitle}>Нет переписок. Открой раздел «Контакты».</Text>}
      renderItem={({item})=><Pressable style={s.entry} onPress={()=>{setMessages([]);setScreen({kind:'chat',conversation:item.conversation,peer:item.peer});}}><Avatar name={item.peer.display_name} url={avatars[item.peer.id]} colors={colors}/><View style={{flex:1}}><Text style={s.entryTitle}>{item.peer.display_name}</Text><Text style={s.subtitle}>Открыть переписку</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted}/></Pressable>}/>;
  }
  return <View style={s.root}><StatusBar style="light"/>
    <View style={{flex:1}}>{content()}</View>
    {screen.kind==='tab'&&<View style={s.bottom}>
      {tabButton('chats','chatbubbles-outline','Чаты')}
      {tabButton('contacts','people-outline','Контакты')}
      {tabButton('calls','call-outline','Звонки')}
      {tabButton('settings','settings-outline','Настройки')}
    </View>}
    {!!notice&&<Pressable style={s.toast} onPress={()=>setNotice('')}><Text style={{color:colors.text}}>{notice}</Text><Ionicons name="close" color={colors.text} size={15}/></Pressable>}
  </View>;
}
function makeStyles(p:Palette){return StyleSheet.create({
  root:{flex:1,backgroundColor:p.bg},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12},pad:{padding:16},
  loginTitle:{fontSize:36,fontWeight:'800',color:p.text,marginTop:8},title:{fontSize:26,fontWeight:'700',color:p.text},
  subtitle:{fontSize:12,color:p.muted,lineHeight:17},headerLabel:{color:p.muted,fontSize:12,letterSpacing:1,textTransform:'uppercase'},
  field:{color:p.text,borderWidth:1,borderColor:p.line,backgroundColor:p.surface,borderRadius:14,paddingHorizontal:15,paddingVertical:12,fontSize:16,minHeight:48,width:'100%'},
  mainAction:{backgroundColor:p.accent,borderRadius:16,padding:15,alignItems:'center',justifyContent:'center',minWidth:170,marginTop:8},
  actionText:{color:'#051a22',fontWeight:'800',fontSize:15},error:{color:p.danger,fontSize:13},
  top:{minHeight:60,flexDirection:'row',alignItems:'center',paddingHorizontal:8,borderBottomWidth:.5,borderColor:p.line},
  bubble:{maxWidth:'85%',borderWidth:1,borderRadius:18,paddingHorizontal:12,paddingVertical:9},
  compose:{flexDirection:'row',alignItems:'center',paddingHorizontal:13,paddingVertical:10,borderTopWidth:.6,borderColor:p.line},
  composeInput:{flex:1,backgroundColor:p.surface,borderRadius:16,color:p.text,paddingHorizontal:14,paddingVertical:11,maxHeight:115,fontSize:16},
  bottom:{flexDirection:'row',justifyContent:'space-around',paddingTop:9,paddingBottom:6,borderTopWidth:1,borderColor:p.line,backgroundColor:p.surface},
  tab:{alignItems:'center',justifyContent:'center',flex:1,gap:3,paddingVertical:2},tabLabel:{fontSize:10,fontWeight:'600'},
  entry:{flexDirection:'row',gap:13,alignItems:'center',padding:11,borderWidth:1,borderColor:p.line,backgroundColor:p.surface,borderRadius:18,minHeight:66},
  entryTitle:{fontWeight:'700',fontSize:15,color:p.text},
  colorGrid:{flexDirection:'row',flexWrap:'wrap',gap:9,marginTop:13},
  colorChip:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:11,paddingVertical:11,borderWidth:1,borderRadius:12},
  toast:{position:'absolute',bottom:87,left:15,right:15,padding:14,borderWidth:1,borderColor:p.danger,backgroundColor:p.elevated,borderRadius:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
});}
export default function App(){return <SafeAreaProvider><SafeAreaView style={{flex:1,backgroundColor:'#07121b'}} edges={['top','bottom']}><AppMain/></SafeAreaView></SafeAreaProvider>;}
