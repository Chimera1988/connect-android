import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,AppState,FlatList,Image,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import {AudioModule,RecordingPresets,setAudioModeAsync,useAudioRecorder,useAudioRecorderState} from 'expo-audio';
import {File} from 'expo-file-system';
import {randomUUID} from 'expo-crypto';
import {db,MESSAGE_COLUMNS,type Conversation,type Message,type Profile} from './backend';
import {ConnectNativeAttachment} from './ConnectNativeMedia';
import ConnectNativeVideoNote from './ConnectNativeVideoNote';
import {dismissChatPush,rememberReadAt} from './ConnectNativePush';
import ConnectNativeAlbum,{parseAlbumReference} from './ConnectNativeAlbum';
import ConnectNativeStickerPicker,{ConnectNativeStickerBubble,parseStickerReference} from './ConnectNativeStickers';
import {saveKeyboardStickerFavorite} from './ConnectNativeStickerLibrary';
import {uploadFile,type LocalUpload} from './nativeMediaUtils';
import type {Palette} from './theme';
import {glassColor} from './ConnectNativeGlass';

const FORWARD_PREFIX='[[connect-forward:';
const forwardMeta=(body:string):{from:string|null;text:string}=>{
  if(!body.startsWith(FORWARD_PREFIX))return {from:null,text:body};
  const idx=body.indexOf(']]\n',FORWARD_PREFIX.length);
  if(idx<0)return {from:null,text:body};
  try{return {from:decodeURIComponent(body.slice(FORWARD_PREFIX.length,idx)),text:body.slice(idx+3)};}
  catch{return {from:null,text:body};}
};
const time=(value:string)=>new Date(value).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
const audioTime=(seconds:number)=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
// CONNECT_NATIVE_PWA_PHASE4_CHAT
const dayKey=(value:string)=>new Date(value).toDateString();
const dayLabel=(value:string)=>{
  const day=new Date(value),today=new Date(),yesterday=new Date();
  yesterday.setDate(today.getDate()-1);
  if(day.toDateString()===today.toDateString())return 'Сегодня';
  if(day.toDateString()===yesterday.toDateString())return 'Вчера';
  return day.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
};
function Btn({name,label,onPress,colors,disabled}:{name:keyof typeof Ionicons.glyphMap;label:string;onPress:()=>void;colors:Palette;disabled?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{padding:8,opacity:disabled ? 0.4 : 1}}>
    <Ionicons name={name} color={colors.accent} size={23}/>
  </Pressable>;
}
function LabelButton({title,onPress,colors,danger=false}:{title:string;onPress:()=>void;colors:Palette;danger?:boolean}){
  return <Pressable onPress={onPress} style={{padding:13,borderBottomColor:colors.line,borderBottomWidth:.5}}>
    <Text style={{fontSize:15,color:danger?colors.danger:colors.text}}>{title}</Text>
  </Pressable>;
}
function ChatAvatar({name,url,colors}:{name:string;url?:string;colors:Palette}){
  return <View style={{width:41,height:41,borderRadius:21,backgroundColor:colors.elevated,borderWidth:1,borderColor:colors.accent,overflow:'hidden',alignItems:'center',justifyContent:'center'}}>
    {url?<Image source={{uri:url}} style={{width:41,height:41}}/>:<Text style={{color:colors.text,fontWeight:'700'}}>{name.slice(0,1)}</Text>}
  </View>;
}
export default function ConnectNativeChat({conversation,peer,ownerId,profiles,avatarUrl,colors,onBack,onOpenProfile,onCall,wallpaperUri,enabledPacks,clearedAt,onClearChat}:{
  conversation:Conversation;peer:Profile;ownerId:string;profiles:Profile[];avatarUrl?:string;colors:Palette;onBack:()=>void;onOpenProfile:()=>void;onCall:()=>void;wallpaperUri?:string|null;enabledPacks?:string[];clearedAt?:string|null;onClearChat:()=>void;
}) {
  const [messages,setMessages]=useState<Message[]>([]);
  const [draft,setDraft]=useState('');
  const [reply,setReply]=useState<Message|null>(null);
  const [edit,setEdit]=useState<Message|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [actionMessage,setActionMessage]=useState<Message|null>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const [selectionMode,setSelectionMode]=useState(false);
  const [searchOpen,setSearchOpen]=useState(false);
  const [toolsOpen,setToolsOpen]=useState(false);
  const [showJump,setShowJump]=useState(false);
  const [visibleMessageIds,setVisibleMessageIds]=useState<string[]>([]);
  const nearBottom=useRef(true);
  const swipeStart=useRef<{id:string;x:number;y:number}|null>(null);
  const [query,setQuery]=useState('');
  const [forwardItems,setForwardItems]=useState<Message[]>([]);
  const [forwardBusy,setForwardBusy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [albumProgress,setAlbumProgress]=useState('');
  const [uploadProgress,setUploadProgress]=useState('');
  const [pendingFiles,setPendingFiles]=useState<LocalUpload[]>([]);
  // CONNECT_NATIVE_CHAT_PARITY_PHASE3: user-scoped local message hiding and receipts.
  const [peerRecording,setPeerRecording]=useState(false);
  const [peerTyping,setPeerTyping]=useState(false);
  const [peerReceipts,setPeerReceipts]=useState<{delivered:string|null;read:string|null}>({delivered:null,read:null});
  const [hidden,setHidden]=useState<string[]>([]);
  const hiddenLoaded=useRef(false);
  const typingLastSent=useRef(0);
  const deliveredLastSent=useRef('');

  const [videoNoteOpen,setVideoNoteOpen]=useState(false);
  const [stickerPickerOpen,setStickerPickerOpen]=useState(false);
  const listRef=useRef<FlatList<Message>>(null);
  const onViewableMessages=useRef(({viewableItems}:{viewableItems:ReadonlyArray<{item:Message;isViewable:boolean|null}>})=>{
    setVisibleMessageIds(viewableItems.filter(row=>row.isViewable).map(row=>row.item.id));
  }).current;
  const videoViewConfig=useRef({itemVisiblePercentThreshold:35}).current;
  const lastSyncedRead=useRef<Record<string,string>>({});
  const seenIncoming=useRef<Record<string,string>>({});
  const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState=useAudioRecorderState(recorder);
  // CONNECT_NATIVE_PWA_PHASE5_MEDIA: recording may be sent or cancelled; never auto-send on cancel.
  const [recordSeconds,setRecordSeconds]=useState(0);
  const recordingBegan=useRef(0);
  const recordingTransition=useRef(false);
  useEffect(()=>{
    if(!recorderState.isRecording)return;
    const timer=setInterval(()=>setRecordSeconds(recordingBegan.current?Math.floor((Date.now()-recordingBegan.current)/1000):0),250);
    return()=>clearInterval(timer);
  },[recorderState.isRecording]);
  const id=conversation.id;
  const localHiddenKey=`connect-native-chat-hidden-v1:${ownerId}:${id}`;
  // PWA compatibility: recording presence is a short, renewed lease (8 s), not
  // a 2-minute stale status if Android loses microphone access or gets killed.
  useEffect(()=>{
    if(!ownerId||!recorderState.isRecording)return;
    let alive=true;
    const pulse=()=>{
      if(!alive||AppState.currentState!=='active')return;
      void db.from('conversation_user_state').upsert({
        conversation_id:id,user_id:ownerId,
        recording_until:new Date(Date.now()+8000).toISOString(),
      },{onConflict:'conversation_id,user_id'}).then(({error})=>{
        if(error)console.warn('Connect recording heartbeat:',error.message);
      });
    };
    pulse();
    const interval=setInterval(pulse,2000);
    return()=>{alive=false;clearInterval(interval);};
  },[ownerId,id,recorderState.isRecording]);
  useEffect(()=>{
    let alive=true;hiddenLoaded.current=false;setHidden([]);
    void SecureStore.getItemAsync(localHiddenKey).then(raw=>{
      if(!alive)return;
      if(raw){const saved:unknown=JSON.parse(raw);if(Array.isArray(saved))setHidden(saved.filter((v):v is string=>typeof v==='string'));}
    }).catch(()=>{}).finally(()=>{if(alive)hiddenLoaded.current=true;});
    return()=>{alive=false;};
  },[localHiddenKey]);
  async function hideLocally(items:Message[]){
    if(!items.length)return;
    // Same per-user semantics as PWA: do not delete messages from the server.
    const next=Array.from(new Set([...hidden,...items.map(m=>m.id)]));
    try{
      await SecureStore.setItemAsync(localHiddenKey,JSON.stringify(next));
      setHidden(next);setSelected([]);setSelectionMode(false);setActionMessage(null);
    }catch(e){setNotice('Не удалось сохранить удаление у себя: '+(e instanceof Error?e.message:String(e)));}
  }
  async function signalTyping(active:boolean){
    if(!ownerId||AppState.currentState!=='active')return;
    const now=Date.now();
    if(active && now-typingLastSent.current<3000)return;
    typingLastSent.current=active?now:0;
    await db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,
      typing_until:active?new Date(now+6000).toISOString():null},
      {onConflict:'conversation_id,user_id'});
  }
  useEffect(()=>{
    if(!draft.trim()){void signalTyping(false);return;}
    void signalTyping(true);
    const end=setTimeout(()=>{void signalTyping(false);},2100);
    return()=>clearTimeout(end);
    // Typing presence follows editor changes, not every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[draft,id,ownerId]);

  const textColor=colors.text;
  const mutedColor=colors.muted;
  const markChatRead=useCallback(async(iso:string)=>{
    if(!ownerId||AppState.currentState!=='active')return;
    if(lastSyncedRead.current[id] && lastSyncedRead.current[id]>=iso)return;
    lastSyncedRead.current[id]=iso;
    const saved=await db.from('conversation_user_state').upsert(
      {conversation_id:id,user_id:ownerId,last_read_at:iso},{onConflict:'conversation_id,user_id'});
    if(saved.error){delete lastSyncedRead.current[id];return;}
    await dismissChatPush(id).catch(()=>{});
    await rememberReadAt(id,iso).catch(()=>{});
    try{
      const {data:{session}}=await db.auth.getSession();
      if(!session?.access_token)return;
      void fetch((process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'')+'/api/push/read',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
        body:JSON.stringify({conversationId:id,readAt:iso}),
      }).catch(()=>{});
    }catch{}
  },[id,ownerId]);
  const load=useCallback(async()=>{
    const result=await db.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id',id).order('created_at',{ascending:false}).limit(300);
    if(result.error){setNotice('Сообщения: '+result.error.message);return;}
    const rows=((result.data||[]) as Message[]).reverse();
    setMessages(rows);
    const latest=[...rows].reverse().find(m=>!m.deleted_at&&m.sender_id!==ownerId);
    // PWA delivery timestamp is the latest incoming message creation time.
    if(latest && AppState.currentState==='active' && latest.created_at>deliveredLastSent.current){
      deliveredLastSent.current=latest.created_at;
      void db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,last_delivered_at:latest.created_at},
        {onConflict:'conversation_id,user_id'}).then(({error})=>{if(error)deliveredLastSent.current='';});
    }

    if(latest && latest.created_at>(seenIncoming.current[id]||'')){
      seenIncoming.current[id]=latest.created_at;
      if(AppState.currentState==='active')void markChatRead(new Date().toISOString());
    }
  },[id,ownerId,markChatRead]);
  useEffect(()=>{
    let alive=true;
    void load();
    // HTTP polling fallback: the Connect DuckDNS proxy does not yet proxy Realtime WebSocket.
    const timer=setInterval(()=>{if(alive)void load();},4500);
    return()=>{alive=false;clearInterval(timer);};
  },[load]);
  useEffect(()=>{
    if(!ownerId)return;
    void markChatRead(new Date().toISOString());
    const subscription=AppState.addEventListener('change',state=>{
      if(state==='active')void markChatRead(new Date().toISOString());
    });
    return()=>subscription.remove();
  },[id,ownerId,markChatRead]);
  useEffect(()=>{
    if(!ownerId||!recorderState.isRecording)return;
    // Keep the existing PWA "recording_until" indicator alive during long recordings.
    const refresh=()=>{
      void db.from('conversation_user_state').upsert({
        conversation_id:id,user_id:ownerId,recording_until:new Date(Date.now()+45000).toISOString(),
      },{onConflict:'conversation_id,user_id'}).then(()=>{});
    };
    refresh();
    const interval=setInterval(refresh,15000);
    return()=>clearInterval(interval);
  },[id,ownerId,recorderState.isRecording]);
  useEffect(()=>{
    let active=true;
    const check=async()=>{
      const response=await db.from('conversation_user_state').select('recording_until,typing_until,last_delivered_at,last_read_at')
        .eq('conversation_id',id).eq('user_id',peer.id).maybeSingle();
      if(active){
        const state=response.data;
        setPeerRecording(Boolean(state?.recording_until && Date.parse(state.recording_until)>Date.now()));
        setPeerTyping(Boolean(state?.typing_until && Date.parse(state.typing_until)>Date.now()));
        setPeerReceipts({delivered:state?.last_delivered_at||null,read:state?.last_read_at||null});
      }
    };
    void check();
    const interval=setInterval(()=>void check(),4000);
    return()=>{active=false;clearInterval(interval);};
  },[id,peer.id]);
  const visible=useMemo(()=>messages.filter(m=>!hidden.includes(m.id) && (!clearedAt || m.created_at>clearedAt)),[messages,hidden,clearedAt]);
  // Keep messages in context while searching: filtering loses chronology and quoted replies.
  const shown=visible;
  const searchMatches=useMemo(()=>{
    const needle=query.trim().toLocaleLowerCase('ru-RU');
    if(!needle)return [] as number[];
    return shown.flatMap((m,i)=>!m.deleted_at&&(
      (m.body||'').toLocaleLowerCase('ru-RU').includes(needle)||
      (m.attachment_name||'').toLocaleLowerCase('ru-RU').includes(needle))?[i]:[]);
  },[shown,query]);
  const [searchIndex,setSearchIndex]=useState(0);
  useEffect(()=>{setSearchIndex(0);},[query]);
  const activeSearchIndex=searchMatches.length?Math.min(searchIndex,searchMatches.length-1):-1;
  const activeSearchId=activeSearchIndex>=0?shown[searchMatches[activeSearchIndex]]?.id:null;
  function findInChat(direction:number){
    if(!searchMatches.length)return;
    const next=(activeSearchIndex+direction+searchMatches.length)%searchMatches.length;
    setSearchIndex(next);
    nearBottom.current=false;
    listRef.current?.scrollToIndex({index:searchMatches[next],animated:true,viewPosition:.35});
  }
  function highlightedText(value:string){
    const needle=searchOpen?query.trim():'';
    if(!needle)return value;
    const lowered=value.toLocaleLowerCase('ru-RU'),term=needle.toLocaleLowerCase('ru-RU');
    const nodes:React.ReactNode[]=[];
    let offset=0,part=0;
    while(offset<value.length){
      const at=lowered.indexOf(term,offset);
      if(at<0){nodes.push(value.slice(offset));break;}
      if(at>offset)nodes.push(value.slice(offset,at));
      nodes.push(<Text key={`hit-${part++}`} style={{backgroundColor:colors.accent,color:colors.bg,fontWeight:'800'}}>{value.slice(at,at+needle.length)}</Text>);
      offset=at+needle.length;
    }
    return nodes;
  }
  const selectedMessages=visible.filter(x=>selected.includes(x.id));
  const confirmDelete=(items:Message[])=>{
    const own=items.filter(x=>x.sender_id===ownerId && !x.deleted_at);
    if(!own.length){setNotice('Удалить у обоих можно только свои сообщения.');return;}
    Alert.alert('Удалить у обоих?',`${own.length} сообщений будут помечены удалёнными для обоих участников.`,[
      {text:'Отмена',style:'cancel'},
      {text:'Удалить',style:'destructive',onPress:()=>void (async()=>{
        setBusy(true);
        try {
          const result=await db.from('messages').update({deleted_at:new Date().toISOString()}).in('id',own.map(x=>x.id)).eq('sender_id',ownerId);
          if(result.error)throw result.error;
          await load();setSelectionMode(false);setSelected([]);
        }catch(e){setNotice(e instanceof Error?e.message:String(e));}
        finally{setBusy(false);}
      })()}
    ]);
  };
  async function submit(){
    const value=draft.trim();
    if(!value||busy)return;
    setBusy(true);
    try{
      if(edit){
        const result=await db.from('messages').update({body:value,edited_at:new Date().toISOString()}).eq('id',edit.id).eq('sender_id',ownerId);
        if(result.error)throw result.error;
      }else{
        const result=await db.from('messages').insert({conversation_id:id,sender_id:ownerId,body:value,reply_to:reply?.id||null});
        if(result.error)throw result.error;
      }
      setDraft('');setReply(null);setEdit(null);await load();
    }catch(e){setNotice('Не отправлено: '+(e instanceof Error?e.message:String(e)));}
    finally{setBusy(false);}
  }
  function action(item:Message){
    if(selectionMode){setSelected(x=>x.includes(item.id)?x.filter(y=>y!==item.id):[...x,item.id]);return;}
    setActionMessage(item);
  }
  async function sendAttachment(file:LocalUpload,kind?:'image'|'video'|'file'|'audio'):Promise<boolean>{
    if(uploading||busy)return false;
    setUploading(true);setUploadProgress('Подготавливаем вложение…');
    const path=`${id}/${ownerId}/${randomUUID()}`;
    try{
      const type=kind||(file.mime.startsWith('image/')?'image':file.mime.startsWith('video/')?'video':'file');
      const size=await uploadFile('connect-attachments',path,file,(sent,total)=>{
        setUploadProgress(`Отправка: ${total?Math.min(100,Math.round(sent/total*100)):0}%`);
      });
      const result=await db.from('messages').insert({
        conversation_id:id,sender_id:ownerId,body:'',attachment_path:path,attachment_name:file.name.slice(0,240),
        attachment_type:file.mime,attachment_size:size,attachment_kind:type,reply_to:reply?.id||null,
      });
      if(result.error){await db.storage.from('connect-attachments').remove([path]);throw result.error;}
      setReply(null);await load();
      return true;
    }catch(e){setNotice('Вложение: '+(e instanceof Error?e.message:String(e)));return false;}
    finally{setUploading(false);setUploadProgress('');}
  }
  // CONNECT_NATIVE_PWA_PHASE6_STICKER_LIBRARY: persist received keyboard images as private stickers.
  async function addKeyboardFavorite(item:Message){
    if(!ownerId||busy)return;
    setBusy(true);setActionMessage(null);
    try{
      const result=await saveKeyboardStickerFavorite(item,ownerId);
      setNotice(result==='exists'?'Этот стикер уже в избранном':'Стикер добавлен в избранное');
    }catch(e){setNotice('Не удалось сохранить стикер: '+(e instanceof Error?e.message:String(e)));}
    finally{setBusy(false);}
  }
  async function sendSticker(body:string):Promise<boolean>{
    if(busy||uploading||!parseStickerReference(body))return false;
    setBusy(true);
    try{
      const result=await db.from('messages').insert({
        conversation_id:id,sender_id:ownerId,body,reply_to:reply?.id||null,
      });
      if(result.error)throw result.error;
      setReply(null);setStickerPickerOpen(false);await load();
      return true;
    }catch(e){setNotice('Стикер не отправлен: '+(e instanceof Error?e.message:String(e)));return false;}
    finally{setBusy(false);}
  }
  async function sendAlbum(files:LocalUpload[]):Promise<boolean>{
    if(uploading||busy||files.length<2||files.length>20)return false;
    setUploading(true);setAlbumProgress('Подготавливаем альбом…');
    const created:string[]=[];
    try{
      // Existing native upload is bounded to 20 MB per file. The whole album is
      // also capped to avoid a long blocked screen before resumable upload lands.
      const total=files.reduce((sum,f)=>sum+(f.size??new File(f.uri).size),0);
      if(total>200*1024*1024)throw new Error('Альбом больше 200 МБ. Выберите меньше файлов.');
      const items:{path:string;name:string;kind:'image'|'video'}[]=[];
      for(let i=0;i<files.length;i++){
        const f=files[i];
        const kind=f.mime.startsWith('video/')?'video':f.mime.startsWith('image/')?'image':null;
        if(!kind)throw new Error('Альбом поддерживает только фото и видео.');
        setAlbumProgress(`Загружаем ${i+1} из ${files.length}…`);
        const path=`${id}/${ownerId}/${randomUUID()}`;
        await uploadFile('connect-attachments',path,f,(sent,total)=>{
          setAlbumProgress(`Загружаем ${i+1} из ${files.length}: ${total?Math.min(100,Math.round(sent/total*100)):0}%`);
        });
        created.push(path);
        items.push({path,name:f.name.slice(0,240),kind});
      }
      const result=await db.from('messages').insert({
        conversation_id:id,sender_id:ownerId,
        body:'[[connect-album:'+JSON.stringify(items)+']]',
        reply_to:reply?.id||null,
      });
      if(result.error)throw result.error;
      setReply(null);
      await load();
      return true;
    }catch(e){
      if(created.length){
        try{await db.storage.from('connect-attachments').remove(created);}catch{/* best effort */}
      }
      setNotice('Альбом: '+(e instanceof Error?e.message:String(e)));
      return false;
    }finally{setUploading(false);setAlbumProgress('');}
  }

  function queueAttachments(files:LocalUpload[]){
    if(!files.length)return;
    const invalid=files.find(f=>(f.size??new File(f.uri).size)>100*1024*1024);
    if(invalid){setNotice('Файл '+invalid.name+' больше 100 МБ');return;}
    setPendingFiles(prev=>{
      if(prev.length+files.length>20){setNotice('Можно выбрать не более 20 файлов за раз');return prev;}
      return [...prev,...files];
    });
  }
  async function sendPending(){
    if(!pendingFiles.length||uploading||busy)return;
    const files=[...pendingFiles];
    const media=files.filter(f=>f.mime.startsWith('image/')||f.mime.startsWith('video/'));
    const documents=files.filter(f=>!f.mime.startsWith('image/')&&!f.mime.startsWith('video/'));
    if(media.length&&documents.length){setNotice('Для альбома выбирайте фото и видео отдельно от документов');return;}
    if(media.length>1){
      if(await sendAlbum(media))setPendingFiles([]);
      return;
    }
    for(let i=0;i<files.length;i++){
      const f=files[i];
      if(!await sendAttachment(f)){
        setPendingFiles(files.slice(i));
        return;
      }
    }
    setPendingFiles([]);
  }
  async function attachMedia(fromCamera=false){
    try{
      if(fromCamera){
        const permission=await ImagePicker.requestCameraPermissionsAsync();
        if(!permission.granted){setNotice('Нужен доступ к камере');return;}
        const result=await ImagePicker.launchCameraAsync({mediaTypes:['images','videos'],quality:0.92});
        if(!result.canceled)for(const a of result.assets){await sendAttachment({uri:a.uri,name:a.fileName||`camera-${Date.now()}.jpg`,mime:a.mimeType||'image/jpeg',size:a.fileSize});}
      }else{
        const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images','videos'],allowsMultipleSelection:true,quality:0.92});
        if(!result.canceled){
          const files:LocalUpload[]=result.assets.map((a,index)=>({
            uri:a.uri,name:a.fileName||`${a.type||'media'}-${Date.now()}-${index}.${a.type==='video'?'mp4':'jpg'}`,
            mime:a.mimeType||(a.type==='video'?'video/mp4':'image/jpeg'),size:a.fileSize,
          }));
          queueAttachments(files);
        }
      }
    }catch(e){setNotice('Камера/галерея: '+(e instanceof Error?e.message:String(e)));}
  }
  async function attachDocument(){
    try{
      const pick=await DocumentPicker.getDocumentAsync({type:'*/*',multiple:true,copyToCacheDirectory:true});
      if(!pick.canceled)queueAttachments(pick.assets.map(file=>({uri:file.uri,name:file.name,mime:file.mimeType||'application/octet-stream',size:file.size})));
    }catch(e){setNotice('Файл: '+(e instanceof Error?e.message:String(e)));}
  }
  // On Android image clipboard data must be explicitly converted from
  // base64 to a local file before using the existing upload/album preview.
  async function attachClipboardImage(){
    if(uploading||busy)return;
    try{
      const hasImage=await Clipboard.hasImageAsync();
      if(!hasImage){setNotice('В буфере обмена нет изображения');return;}
      const value=await Clipboard.getImageAsync({format:'png'});
      if(!value?.data){setNotice('Изображение из буфера недоступно');return;}
      const raw=value.data.startsWith('data:')?value.data.slice(value.data.indexOf(',')+1):value.data;
      // Protect against unexpectedly huge clipboard payloads before writing.
      if(!raw||raw.length>125*1024*1024)throw Error('Изображение из буфера слишком большое');
      if(!FileSystem.cacheDirectory)throw Error('Кэш Android недоступен');
      const uri=FileSystem.cacheDirectory+`connect-clipboard-${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(uri,raw,{encoding:FileSystem.EncodingType.Base64});
      const size=new File(uri).size;
      if(size<=0||size>100*1024*1024){
        await FileSystem.deleteAsync(uri,{idempotent:true});
        throw Error('Размер изображения должен быть до 100 МБ');
      }
      queueAttachments([{uri,name:`clipboard-${Date.now()}.png`,mime:'image/png',size}]);
      setNotice('Фото добавлено из буфера. Проверь его перед отправкой.');
    }catch(e){setNotice('Буфер обмена: '+(e instanceof Error?e.message:String(e)));}
  }
  function showAttachmentMenu(){
    Alert.alert('Прикрепить','Выбери источник',[
      {text:'Фото/видео',onPress:()=>void attachMedia()},
      {text:'Камера',onPress:()=>void attachMedia(true)},
      {text:'Файл',onPress:()=>void attachDocument()},
      {text:'Фото из буфера',onPress:()=>void attachClipboardImage()},
      {text:'Отмена',style:'cancel'},
    ]);
  }
  async function clearRecordingPresence(){
    await db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,recording_until:null},{onConflict:'conversation_id,user_id'});
  }
  async function cancelRecord(){
    if(!recorderState.isRecording||recordingTransition.current)return;
    recordingTransition.current=true;
    try{
      await recorder.stop();
      recordingBegan.current=0;setRecordSeconds(0);
      await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});
      await clearRecordingPresence();
      setNotice('Запись отменена');
    }catch(e){setNotice('Отмена записи: '+(e instanceof Error?e.message:String(e)));}
    finally{recordingTransition.current=false;}
  }
  async function toggleRecord(){
    if(uploading||recordingTransition.current)return;
    recordingTransition.current=true;
    try{
      if(recorderState.isRecording){
        await recorder.stop();
        const uri=recorder.uri;
        recordingBegan.current=0;setRecordSeconds(0);
        // Release microphone audio mode immediately, before an upload that can take minutes.
        await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});
        await clearRecordingPresence();
        if(!uri)throw new Error('Запись не найдена');
        const bytes=new File(uri).size;
        if(bytes<1000)throw new Error('Записан пустой файл. Попробуйте ещё раз.');
        await sendAttachment({uri,name:`connect-voice-${Date.now()}.m4a`,mime:'audio/mp4',size:bytes},'audio');
      }else{
        const permission=await AudioModule.requestRecordingPermissionsAsync();
        if(!permission.granted){setNotice('Нужен доступ к микрофону');return;}
        await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});
        await recorder.prepareToRecordAsync();
        recordingBegan.current=Date.now();setRecordSeconds(0);
        recorder.record();
        await db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,recording_until:new Date(Date.now()+8000).toISOString()},{onConflict:'conversation_id,user_id'});
      }
    }catch(e){setNotice('Запись: '+(e instanceof Error?e.message:String(e)));}
    finally{recordingTransition.current=false;}
  }
  async function forwardTo(profile:Profile){
    if(forwardBusy||!forwardItems.length)return;
    setForwardBusy(true);
    try{
      const [user_a,user_b]=[ownerId,profile.id].sort();
      const cr=await db.from('conversations').upsert({user_a,user_b},{onConflict:'user_a,user_b'}).select('id').single();
      if(cr.error||!cr.data)throw cr.error||new Error('Не удалось создать чат');
      for(const m of forwardItems){
        const author=profiles.find(p=>p.id===m.sender_id)?.display_name||'Пользователь';
        const original=forwardMeta(m.body||'');
        let path:string|null=null;
        if(m.attachment_path){
          path=`${cr.data.id}/${ownerId}/${randomUUID()}`;
          const copied=await db.storage.from('connect-attachments').copy(m.attachment_path,path);
          if(copied.error)throw copied.error;
        }
        const row=await db.from('messages').insert({conversation_id:cr.data.id,sender_id:ownerId,
          body:`${FORWARD_PREFIX}${encodeURIComponent(original.from||author)}]]\n${original.text}`,
          attachment_path:path,attachment_name:path?m.attachment_name:null,attachment_type:path?m.attachment_type:null,
          attachment_kind:path?m.attachment_kind:null,attachment_size:path?m.attachment_size:null});
        if(row.error){if(path)await db.storage.from('connect-attachments').remove([path]);throw row.error;}
      }
      setForwardItems([]);setSelected([]);setSelectionMode(false);setNotice('Переслано: '+forwardItems.length);
    }catch(e){setNotice('Не удалось переслать: '+(e instanceof Error?e.message:String(e)));}
    finally{setForwardBusy(false);}
  }
  const menuStyle={backgroundColor:colors.surface,borderRadius:17,padding:12,marginHorizontal:20,maxHeight:'80%' as const};
  return <KeyboardAvoidingView style={{flex:1,backgroundColor:'transparent'}} behavior={Platform.OS==='ios'?'padding':undefined}>
    {!!wallpaperUri&&<Image pointerEvents="none" source={{uri:wallpaperUri}} resizeMode="cover" style={{position:'absolute',top:0,bottom:0,left:0,right:0,width:'100%',height:'100%',opacity:.66}}/>}
    <View style={{flexDirection:'row',alignItems:'center',gap:5,padding:7,marginHorizontal:8,marginTop:5,marginBottom:8,borderWidth:1,borderColor:glassColor(colors.text,.17),borderRadius:23,backgroundColor:glassColor(colors.surface,.84)}}>
      <Btn name="chevron-back" label="Назад" colors={colors} onPress={onBack}/>
      <Pressable style={{flexDirection:'row',alignItems:'center',gap:8,flex:1,minWidth:0}} onPress={onOpenProfile}>
        <ChatAvatar name={peer.display_name} url={avatarUrl} colors={colors}/>
        <View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={{color:textColor,fontSize:17,fontWeight:'700'}}>{peer.display_name}</Text>
          <Text style={{fontSize:11,color:colors.muted}}>{peerRecording?'Записывает голосовое…':peerTyping?'Печатает…':peer.online_until&&Date.parse(peer.online_until)>Date.now()?'В сети':'Не в сети'}</Text></View>
      </Pressable>
      <Btn name="call-outline" label="Аудиозвонок" colors={colors} onPress={onCall}/>
      <Btn name="ellipsis-vertical" label="Действия в чате" colors={colors} onPress={()=>setToolsOpen(true)}/>
    </View>
    <Modal visible={toolsOpen} transparent animationType="fade" onRequestClose={()=>setToolsOpen(false)}>
      <View style={{flex:1,justifyContent:'center',backgroundColor:'#020914bb'}}>
        <Pressable style={{position:'absolute',top:0,bottom:0,left:0,right:0}} onPress={()=>setToolsOpen(false)}/>
        <View style={{margin:22,borderRadius:18,padding:9,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line}}>
          <LabelButton title="Найти в чате" colors={colors} onPress={()=>{setToolsOpen(false);setSearchOpen(true);}}/>
          <LabelButton title="Выбрать сообщения" colors={colors} onPress={()=>{setToolsOpen(false);setSelectionMode(true);}}/>
          <LabelButton title="Удалить переписку" colors={colors} danger onPress={()=>{setToolsOpen(false);onClearChat();}}/>
          <LabelButton title="Закрыть" colors={colors} onPress={()=>setToolsOpen(false)}/>
        </View>
      </View>
    </Modal>
    {searchOpen&&<View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:10,gap:2}}>
      <TextInput value={query} onChangeText={setQuery} placeholder="Найти в чате" placeholderTextColor={mutedColor}
        accessibilityLabel="Поиск сообщений в текущем чате" style={{flex:1,color:textColor,padding:10,minWidth:40}}/>
      <Text style={{color:mutedColor,fontSize:11}}>{query.trim()?`${searchMatches.length?activeSearchIndex+1:0}/${searchMatches.length}`:''}</Text>
      <Btn name="chevron-up" label="Предыдущее совпадение" colors={colors} disabled={!searchMatches.length} onPress={()=>findInChat(-1)}/>
      <Btn name="chevron-down" label="Следующее совпадение" colors={colors} disabled={!searchMatches.length} onPress={()=>findInChat(1)}/>
      <Btn name="close" label="Закрыть поиск" colors={colors} onPress={()=>{setSearchOpen(false);setQuery('');}}/>
    </View>}
    {selectionMode&&<View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:12,backgroundColor:colors.surface}}>
      <Text style={{color:textColor}}>Выбрано: {selected.length}</Text>
      <Btn name="arrow-redo-outline" label="Переслать" colors={colors} disabled={!selected.length} onPress={()=>setForwardItems(selectedMessages)}/>
      <Btn name="trash-outline" label="Удалить у себя" colors={colors} disabled={!selected.length} onPress={()=>void hideLocally(selectedMessages)}/>
      <Btn name="trash-bin-outline" label="Удалить у всех" colors={colors} disabled={!selected.length||selectedMessages.some(m=>m.sender_id!==ownerId)} onPress={()=>confirmDelete(selectedMessages)}/>
      <Btn name="close" label="Отмена" colors={colors} onPress={()=>{setSelectionMode(false);setSelected([]);}}/>
    </View>}
    <FlatList key={id} ref={listRef} data={shown} keyExtractor={m=>m.id}
      onViewableItemsChanged={onViewableMessages} viewabilityConfig={videoViewConfig}
      onScrollToIndexFailed={info=>listRef.current?.scrollToOffset({offset:Math.max(0,info.averageItemLength*info.index),animated:true})}
      contentContainerStyle={{padding:14,gap:7,paddingBottom:18}}
      scrollEventThrottle={120}
      onScroll={e=>{
        const {contentOffset,contentSize,layoutMeasurement}=e.nativeEvent;
        const bottom=contentOffset.y+layoutMeasurement.height>=contentSize.height-110;
        nearBottom.current=bottom;
        setShowJump(!bottom && contentSize.height>layoutMeasurement.height+130);
      }}
      onContentSizeChange={()=>{if(nearBottom.current)listRef.current?.scrollToEnd({animated:false});}}
      renderItem={({item,index})=>{
        const own=item.sender_id===ownerId;
        const f=forwardMeta(item.body||'');
        const sticker=parseStickerReference(f.text);
        const album=parseAlbumReference(f.text);
        const keyboardSticker=item.attachment_kind==='image'&&/^sticker-\d+\.(?:png|webp|gif|jpe?g)$/i.test(item.attachment_name||'');
        const standalone=Boolean(sticker||keyboardSticker)&&!item.deleted_at;
        const isSelected=selected.includes(item.id);
        const dayBreak=index===0||dayKey(shown[index-1].created_at)!==dayKey(item.created_at);
        const original=item.reply_to?messages.find(row=>row.id===item.reply_to):null;
        const quoteText=!original?'Исходное сообщение':original.deleted_at?'Сообщение удалено':
          original.attachment_name||forwardMeta(original.body||'').text||'Вложение';
        return <View>
          {dayBreak&&<View style={{alignItems:'center',marginVertical:10}}><Text style={{fontSize:11,color:colors.muted,backgroundColor:glassColor(colors.surface,.85),paddingHorizontal:14,paddingVertical:6,borderRadius:13}}>{dayLabel(item.created_at)}</Text></View>}
          <Pressable onLongPress={()=>action(item)} onPress={()=>{if(selectionMode)action(item);}}
          onTouchStart={e=>{const t=e.nativeEvent.touches[0];if(t)swipeStart.current={id:item.id,x:t.pageX,y:t.pageY};}}
          onTouchEnd={e=>{const start=swipeStart.current;swipeStart.current=null;if(!start||start.id!==item.id||selectionMode)return;
            const t=e.nativeEvent.changedTouches[0];if(!t)return;
            const dx=t.pageX-start.x,dy=t.pageY-start.y;
            if(dx>75&&Math.abs(dx)>Math.abs(dy)*1.5){setReply(item);setEdit(null);setActionMessage(null);}
          }}
          onTouchCancel={()=>{swipeStart.current=null;}}
          style={{alignSelf:own?'flex-end':'flex-start',maxWidth:'90%',padding:standalone?4:10,borderRadius:17,
          borderWidth:isSelected||activeSearchId===item.id?2:standalone?0:1,borderColor:isSelected||activeSearchId===item.id?colors.accent:own?glassColor(colors.accent,.32):glassColor(colors.text,.15),backgroundColor:standalone?'transparent':own?glassColor(colors.elevated,.84):glassColor(colors.surface,.82)}}>
          {Boolean(f.from)&&!item.deleted_at&&<Text style={{fontSize:11,color:colors.accent,marginBottom:4}}>Переслано от {f.from}</Text>}
          {item.deleted_at?<Text style={{color:mutedColor,fontStyle:'italic'}}>Сообщение удалено</Text>:<>
            {item.reply_to&&<View style={{borderLeftWidth:3,borderLeftColor:colors.accent,paddingLeft:8,marginBottom:6}}>
              <Text style={{fontSize:11,color:colors.accent,fontWeight:'700'}}>{original?.sender_id===ownerId?'Вы':peer.display_name}</Text>
              <Text numberOfLines={2} style={{fontSize:12,color:colors.muted}}>{quoteText}</Text>
            </View>}
            {item.attachment_path&&<ConnectNativeAttachment message={item} colors={colors} videoAutoPlay={visibleMessageIds.includes(item.id)}/>}
            {album?<ConnectNativeAlbum items={album} colors={colors}/>:sticker?<ConnectNativeStickerBubble body={f.text} colors={colors}/>:
              Boolean(f.text)&&<Text style={{fontSize:15,color:textColor}}>{f.text.startsWith('[[')?'Формат сообщения ещё не поддерживается':highlightedText(f.text)}</Text>}
          </>}
          <View style={{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:4,marginTop:5}}>
            <Text style={{color:mutedColor,fontSize:10}}>{time(item.created_at)}{item.edited_at?' · изм.':''}</Text>
            {own&&!item.deleted_at&&<Text accessibilityLabel={peerReceipts.read&&peerReceipts.read>=item.created_at?'Прочитано':peerReceipts.delivered&&peerReceipts.delivered>=item.created_at?'Доставлено':'Отправлено'} style={{fontSize:11,color:peerReceipts.read&&peerReceipts.read>=item.created_at?colors.accent:mutedColor}}>{peerReceipts.read&&peerReceipts.read>=item.created_at?'✓✓':peerReceipts.delivered&&peerReceipts.delivered>=item.created_at?'✓✓':'✓'}</Text>}
          </View>
          </Pressable>
        </View>;
      }}/>
    {showJump&&<Pressable accessibilityRole="button" accessibilityLabel="К последнему сообщению"
      onPress={()=>{nearBottom.current=true;listRef.current?.scrollToEnd({animated:true});setShowJump(false);}}
      style={{alignSelf:'flex-end',flexDirection:'row',alignItems:'center',gap:6,marginRight:18,marginBottom:5,paddingHorizontal:13,paddingVertical:8,borderRadius:18,backgroundColor:glassColor(colors.surface,.92),borderWidth:1,borderColor:colors.line}}>
      <Ionicons name="arrow-down" size={18} color={colors.accent}/><Text style={{fontSize:12,color:colors.text}}>Вниз</Text>
    </Pressable>}
    {(peerRecording||peerTyping)&&<View style={{paddingHorizontal:14,paddingVertical:5}}>
      <Text style={{fontSize:12,color:colors.accent}}>{peerRecording?`● ${peer.display_name} записывает голосовое…`:`${peer.display_name} печатает…`}</Text>
    </View>}
    {Boolean(reply||edit)&&<View style={{paddingHorizontal:12,paddingVertical:5,backgroundColor:colors.surface,flexDirection:'row',alignItems:'center',gap:8}}>
      <Text numberOfLines={1} style={{flex:1,color:colors.accent,fontSize:12}}>{edit?'Редактирование':`Ответ: ${reply?.body||reply?.attachment_name||'вложение'}`}</Text>
      <Btn name="close" colors={colors} label="Отмена" onPress={()=>{setReply(null);setEdit(null);setDraft('');}}/>
    </View>}
    {stickerPickerOpen&&<ConnectNativeStickerPicker colors={colors} ownerId={ownerId} busy={busy||uploading} enabledPacks={enabledPacks}
      onClose={()=>setStickerPickerOpen(false)} onEmoji={emoji=>setDraft(text=>text+emoji)} onSend={sendSticker}/>}
    <View style={{flexDirection:'row',alignItems:'center',padding:7,marginHorizontal:8,marginBottom:8,borderWidth:1,borderColor:glassColor(colors.text,.17),backgroundColor:glassColor(colors.surface,.86),borderRadius:24,gap:2}}>
      <Btn name="happy-outline" colors={colors} label="Стикеры и эмодзи" disabled={uploading||recorderState.isRecording}
        onPress={()=>{Keyboard.dismiss();setStickerPickerOpen(open=>!open);}}/>
      <Btn name="attach-outline" colors={colors} label="Прикрепить" onPress={showAttachmentMenu} disabled={uploading||busy}/>
      <Btn name="radio-button-on-outline" colors={colors} label="Записать видеокружок" onPress={()=>setVideoNoteOpen(true)} disabled={uploading||busy||recorderState.isRecording}/>
      <TextInput multiline maxLength={10000} placeholder={uploading?'Отправка файла…':'Сообщение'} placeholderTextColor={mutedColor}
        value={draft} onChangeText={setDraft} style={{backgroundColor:glassColor(colors.bg,.30),color:textColor,borderRadius:18,paddingHorizontal:12,paddingVertical:10,fontSize:15,maxHeight:110,flex:1}}/>
      {!recorderState.isRecording&&Boolean(draft.trim())?<Btn name="send" colors={colors} label="Отправить" disabled={busy} onPress={()=>void submit()}/>
      :<Btn name={recorderState.isRecording?'stop-circle':'mic-outline'} colors={colors}
        label={recorderState.isRecording?'Остановить и отправить запись':'Записать голосовое'} onPress={()=>void toggleRecord()}/>}
    </View>
    {pendingFiles.length>0&&<View style={{marginHorizontal:10,marginBottom:7,padding:10,borderRadius:15,backgroundColor:glassColor(colors.surface,.93),borderWidth:1,borderColor:colors.line}}>
      <Text style={{color:colors.text,fontSize:13,fontWeight:'700',marginBottom:8}}>Выбрано файлов: {pendingFiles.length}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
        {pendingFiles.map((file,index)=><View key={`${file.uri}-${index}`} style={{width:105,marginRight:10,gap:3}}>
          {file.mime.startsWith('image/')?<Image source={{uri:file.uri}} resizeMode="cover" style={{width:102,height:68,borderRadius:8}}/>:
            <View style={{width:102,height:68,backgroundColor:colors.elevated,borderRadius:8,alignItems:'center',justifyContent:'center'}}>
              <Ionicons name={file.mime.startsWith('video/')?'videocam-outline':'document-outline'} size={30} color={colors.accent}/>
            </View>}
          <Text numberOfLines={2} style={{color:colors.text,fontSize:11}}>{file.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Убрать ${file.name}`} disabled={uploading}
            onPress={()=>setPendingFiles(prev=>prev.filter((_,j)=>j!==index))}>
            <Text style={{color:colors.danger,fontSize:12}}>Убрать</Text>
          </Pressable>
        </View>)}
      </ScrollView>
      <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:7}}>
        <Btn name="close-circle-outline" label="Отменить выбор" colors={colors} disabled={uploading} onPress={()=>setPendingFiles([])}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Отправить выбранные вложения" disabled={uploading||busy}
          onPress={()=>void sendPending()} style={{padding:10,borderRadius:12,backgroundColor:colors.accent,opacity:uploading?0.5:1}}>
          <Text style={{color:colors.bg,fontSize:13,fontWeight:'800'}}>Отправить выбранное</Text>
        </Pressable>
      </View>
    </View>}
    {uploadProgress!==''&&<Text style={{color:colors.accent,textAlign:'center',padding:5}}>{uploadProgress}</Text>}
    {albumProgress!==''&&<Text style={{color:colors.accent,textAlign:'center',padding:5}}>{albumProgress}</Text>}
    {recorderState.isRecording&&<View style={{paddingHorizontal:14,paddingVertical:9,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10}}>
      <Text style={{color:colors.danger,fontWeight:'700',fontSize:13}}>● Запись {audioTime(recordSeconds)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Отменить голосовое сообщение" onPress={()=>void cancelRecord()}
        style={{padding:8,borderRadius:10,backgroundColor:colors.elevated}}>
        <Text style={{color:colors.danger,fontWeight:'700',fontSize:13}}>Отменить</Text>
      </Pressable>
      <Text style={{color:colors.muted,fontSize:12}}>Стоп — отправить</Text>
    </View>}
    {Boolean(notice)&&<Pressable onPress={()=>setNotice('')} style={{padding:10,backgroundColor:colors.elevated}}><Text style={{color:colors.danger}}>{notice} ×</Text></Pressable>}
    <ConnectNativeVideoNote visible={videoNoteOpen} colors={colors} onClose={()=>setVideoNoteOpen(false)}
      onSend={file=>sendAttachment(file,'video')}/>
    <Modal visible={Boolean(actionMessage)} onRequestClose={()=>setActionMessage(null)} animationType="fade" transparent>
      <Pressable onPress={()=>setActionMessage(null)} style={{flex:1,justifyContent:'center',backgroundColor:'#020914bb'}}>
        <View style={menuStyle}>
          {actionMessage&&!actionMessage.deleted_at&&<>
            <LabelButton title="Ответить" colors={colors} onPress={()=>{setReply(actionMessage);setEdit(null);setActionMessage(null);}}/>
            <LabelButton title="Переслать" colors={colors} onPress={()=>{setForwardItems([actionMessage]);setActionMessage(null);}}/>
            <LabelButton title="Выбрать" colors={colors} onPress={()=>{setSelectionMode(true);setSelected([actionMessage.id]);setActionMessage(null);}}/>
            {actionMessage.attachment_kind==='image'&&/^sticker-\d+\.(?:png|webp|gif|jpe?g)$/i.test(actionMessage.attachment_name||'')&&
              <LabelButton title="Добавить стикер в избранное" colors={colors} onPress={()=>void addKeyboardFavorite(actionMessage)}/>}
            <LabelButton title="Удалить у себя" colors={colors} onPress={()=>{void hideLocally([actionMessage]);setActionMessage(null);}}/>
            {Boolean(actionMessage.body)&&<LabelButton title="Копировать текст" colors={colors} onPress={()=>{void Clipboard.setStringAsync(forwardMeta(actionMessage.body).text);setActionMessage(null);}}/>}
            {actionMessage.sender_id===ownerId&&<>
              {!actionMessage.attachment_path&&<LabelButton title="Редактировать" colors={colors} onPress={()=>{setEdit(actionMessage);setReply(null);setDraft(forwardMeta(actionMessage.body).text);setActionMessage(null);}}/>}
              <LabelButton title="Удалить у обоих" danger colors={colors} onPress={()=>{confirmDelete([actionMessage]);setActionMessage(null);}}/>
            </>}
          </>}
          <LabelButton title="Закрыть" colors={colors} onPress={()=>setActionMessage(null)}/>
        </View>
      </Pressable>
    </Modal>
    <Modal visible={forwardItems.length>0} onRequestClose={()=>setForwardItems([])} transparent animationType="slide">
      <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#020914bb'}}>
        <View style={{...menuStyle,marginHorizontal:0,borderBottomLeftRadius:0,borderBottomRightRadius:0,paddingBottom:30}}>
          <Text style={{fontSize:19,fontWeight:'700',color:textColor,marginBottom:12}}>Переслать кому?</Text>
          <ScrollView style={{maxHeight:320}}>
            {profiles.filter(x=>x.id!==ownerId&&!x.is_blocked).map(p=><LabelButton key={p.id} colors={colors} title={p.display_name} onPress={()=>void forwardTo(p)}/>)}
          </ScrollView>
          <LabelButton title={forwardBusy?'Отправляем…':'Отмена'} colors={colors} onPress={()=>setForwardItems([])}/>
        </View>
      </View>
    </Modal>
  </KeyboardAvoidingView>;
}
