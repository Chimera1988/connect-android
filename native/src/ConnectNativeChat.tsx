import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,FlatList,Image,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import {AudioModule,RecordingPresets,setAudioModeAsync,useAudioRecorder,useAudioRecorderState} from 'expo-audio';
import {File} from 'expo-file-system';
import {randomUUID} from 'expo-crypto';
import {db,MESSAGE_COLUMNS,type Conversation,type Message,type Profile} from './backend';
import {ConnectNativeAttachment} from './ConnectNativeMedia';
import ConnectNativeVideoNote from './ConnectNativeVideoNote';
import ConnectNativeStickerPicker,{ConnectNativeStickerBubble,parseStickerReference} from './ConnectNativeStickers';
import {uploadFile,type LocalUpload} from './nativeMediaUtils';
import type {Palette} from './theme';

const FORWARD_PREFIX='[[connect-forward:';
const forwardMeta=(body:string):{from:string|null;text:string}=>{
  if(!body.startsWith(FORWARD_PREFIX))return {from:null,text:body};
  const idx=body.indexOf(']]\n',FORWARD_PREFIX.length);
  if(idx<0)return {from:null,text:body};
  try{return {from:decodeURIComponent(body.slice(FORWARD_PREFIX.length,idx)),text:body.slice(idx+3)};}
  catch{return {from:null,text:body};}
};
const time=(value:string)=>new Date(value).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
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
export default function ConnectNativeChat({conversation,peer,ownerId,profiles,avatarUrl,colors,onBack,onOpenProfile,onCall}:{
  conversation:Conversation;peer:Profile;ownerId:string;profiles:Profile[];avatarUrl?:string;colors:Palette;onBack:()=>void;onOpenProfile:()=>void;onCall:()=>void;
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
  const [query,setQuery]=useState('');
  const [forwardItems,setForwardItems]=useState<Message[]>([]);
  const [forwardBusy,setForwardBusy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [videoNoteOpen,setVideoNoteOpen]=useState(false);
  const [stickerPickerOpen,setStickerPickerOpen]=useState(false);
  const listRef=useRef<FlatList<Message>>(null);
  const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState=useAudioRecorderState(recorder);
  const id=conversation.id;
  const textColor=colors.text;
  const mutedColor=colors.muted;
  const load=useCallback(async()=>{
    const result=await db.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id',id).order('created_at',{ascending:false}).limit(300);
    if(result.error){setNotice('Сообщения: '+result.error.message);return;}
    setMessages(((result.data||[]) as Message[]).reverse());
  },[id]);
  useEffect(()=>{
    let alive=true;
    void load();
    // HTTP polling fallback: the Connect DuckDNS proxy does not yet proxy Realtime WebSocket.
    const timer=setInterval(()=>{if(alive)void load();},4500);
    return()=>{alive=false;clearInterval(timer);};
  },[load]);
  useEffect(()=>{
    if(!ownerId)return;
    void db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,last_read_at:new Date().toISOString()},{onConflict:'conversation_id,user_id'});
    const timer=setInterval(()=>{
      void db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,last_read_at:new Date().toISOString()},{onConflict:'conversation_id,user_id'});
    },13000);
    return()=>clearInterval(timer);
  },[id,ownerId]);
  const shown=useMemo(()=>query.trim()?messages.filter(m=>
    (m.body||'').toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')) ||
    (m.attachment_name||'').toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'))):messages,[messages,query]);
  const selectedMessages=messages.filter(x=>selected.includes(x.id));
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
    setUploading(true);
    const path=`${id}/${ownerId}/${randomUUID()}`;
    try{
      const type=kind||(file.mime.startsWith('image/')?'image':file.mime.startsWith('video/')?'video':'file');
      const size=await uploadFile('connect-attachments',path,file);
      const result=await db.from('messages').insert({
        conversation_id:id,sender_id:ownerId,body:'',attachment_path:path,attachment_name:file.name.slice(0,240),
        attachment_type:file.mime,attachment_size:size,attachment_kind:type,reply_to:reply?.id||null,
      });
      if(result.error){await db.storage.from('connect-attachments').remove([path]);throw result.error;}
      setReply(null);await load();
      return true;
    }catch(e){setNotice('Вложение: '+(e instanceof Error?e.message:String(e)));return false;}
    finally{setUploading(false);}
  }
  async function sendSticker(body:string):Promise<void>{
    if(busy||uploading||!parseStickerReference(body))return;
    setBusy(true);
    try{
      const result=await db.from('messages').insert({
        conversation_id:id,sender_id:ownerId,body,reply_to:reply?.id||null,
      });
      if(result.error)throw result.error;
      setReply(null);setStickerPickerOpen(false);await load();
    }catch(e){setNotice('Стикер не отправлен: '+(e instanceof Error?e.message:String(e)));}
    finally{setBusy(false);}
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
        if(!result.canceled)for(const a of result.assets){await sendAttachment({uri:a.uri,name:a.fileName||`${a.type||'media'}-${Date.now()}.${a.type==='video'?'mp4':'jpg'}`,mime:a.mimeType||(a.type==='video'?'video/mp4':'image/jpeg'),size:a.fileSize});}
      }
    }catch(e){setNotice('Камера/галерея: '+(e instanceof Error?e.message:String(e)));}
  }
  async function attachDocument(){
    try{
      const pick=await DocumentPicker.getDocumentAsync({type:'*/*',multiple:false,copyToCacheDirectory:true});
      if(!pick.canceled)for(const file of pick.assets){await sendAttachment({uri:file.uri,name:file.name,mime:file.mimeType||'application/octet-stream',size:file.size});}
    }catch(e){setNotice('Файл: '+(e instanceof Error?e.message:String(e)));}
  }
  function showAttachmentMenu(){
    Alert.alert('Прикрепить','Выбери источник',[{text:'Фото/видео',onPress:()=>void attachMedia()},{text:'Камера',onPress:()=>void attachMedia(true)},{text:'Файл',onPress:()=>void attachDocument()}]);
  }
  async function toggleRecord(){
    if(uploading)return;
    try{
      if(recorderState.isRecording){
        await recorder.stop();
        const uri=recorder.uri;
        if(!uri)throw new Error('Запись не найдена');
        await db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,recording_until:null},{onConflict:'conversation_id,user_id'});
        await sendAttachment({uri,name:`connect-voice-${Date.now()}.m4a`,mime:'audio/mp4',size:new File(uri).size},'audio');
        await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});
      }else{
        const permission=await AudioModule.requestRecordingPermissionsAsync();
        if(!permission.granted){setNotice('Нужен доступ к микрофону');return;}
        await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});
        await recorder.prepareToRecordAsync();
        recorder.record();
        await db.from('conversation_user_state').upsert({conversation_id:id,user_id:ownerId,recording_until:new Date(Date.now()+120000).toISOString()},{onConflict:'conversation_id,user_id'});
      }
    }catch(e){setNotice('Запись: '+(e instanceof Error?e.message:String(e)));}
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
  return <KeyboardAvoidingView style={{flex:1,backgroundColor:colors.bg}} behavior={Platform.OS==='ios'?'padding':undefined}>
    <View style={{flexDirection:'row',alignItems:'center',gap:5,padding:9,borderBottomWidth:.6,borderBottomColor:colors.line}}>
      <Btn name="chevron-back" label="Назад" colors={colors} onPress={onBack}/>
      <Pressable style={{flexDirection:'row',alignItems:'center',gap:8,flex:1,minWidth:0}} onPress={onOpenProfile}>
        <ChatAvatar name={peer.display_name} url={avatarUrl} colors={colors}/>
        <Text numberOfLines={1} style={{color:textColor,fontSize:17,fontWeight:'700',flex:1}}>{peer.display_name}</Text>
      </Pressable>
      <Btn name="call-outline" label="Аудиозвонок" colors={colors} onPress={onCall}/>
      <Btn name="ellipsis-vertical" label="Действия в чате" colors={colors} onPress={()=>setSearchOpen(!searchOpen)}/>
    </View>
    {searchOpen&&<View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:12,gap:8}}>
      <TextInput value={query} onChangeText={setQuery} placeholder="Найти в чате" placeholderTextColor={mutedColor} style={{flex:1,color:textColor,padding:10}}/>
      <Btn name="checkbox-outline" label="Выбрать сообщения" colors={colors} onPress={()=>{setSelectionMode(true);setSearchOpen(false);}}/>
      <Btn name="close" label="Закрыть поиск" colors={colors} onPress={()=>{setSearchOpen(false);setQuery('');}}/>
    </View>}
    {selectionMode&&<View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:12,backgroundColor:colors.surface}}>
      <Text style={{color:textColor}}>Выбрано: {selected.length}</Text>
      <Btn name="arrow-redo-outline" label="Переслать" colors={colors} disabled={!selected.length} onPress={()=>setForwardItems(selectedMessages)}/>
      <Btn name="trash-outline" label="Удалить выбранные" colors={colors} disabled={!selected.length} onPress={()=>confirmDelete(selectedMessages)}/>
      <Btn name="close" label="Отмена" colors={colors} onPress={()=>{setSelectionMode(false);setSelected([]);}}/>
    </View>}
    <FlatList key={id} ref={listRef} data={shown} keyExtractor={m=>m.id}
      contentContainerStyle={{padding:14,gap:7,paddingBottom:18}} onContentSizeChange={()=>listRef.current?.scrollToEnd({animated:false})}
      renderItem={({item})=>{
        const own=item.sender_id===ownerId;
        const f=forwardMeta(item.body||'');
        const sticker=parseStickerReference(f.text);
        const keyboardSticker=item.attachment_kind==='image'&&/^sticker-\d+\.(?:png|webp|gif|jpe?g)$/i.test(item.attachment_name||'');
        const standalone=Boolean(sticker||keyboardSticker)&&!item.deleted_at;
        const isSelected=selected.includes(item.id);
        return <Pressable onLongPress={()=>action(item)} onPress={()=>{if(selectionMode)action(item);}} style={{alignSelf:own?'flex-end':'flex-start',maxWidth:'90%',padding:standalone?4:10,borderRadius:17,
          borderWidth:isSelected?2:standalone?0:1,borderColor:isSelected?colors.accent:own?colors.accent:colors.line,backgroundColor:standalone?'transparent':own?colors.elevated:colors.surface}}>
          {Boolean(f.from)&&!item.deleted_at&&<Text style={{fontSize:11,color:colors.accent,marginBottom:4}}>Переслано от {f.from}</Text>}
          {item.deleted_at?<Text style={{color:mutedColor,fontStyle:'italic'}}>Сообщение удалено</Text>:<>
            {item.reply_to&&<Text style={{fontSize:10,color:colors.accent,marginBottom:4}}>↩ Ответ на сообщение</Text>}
            {item.attachment_path&&<ConnectNativeAttachment message={item} colors={colors}/>}
            {sticker?<ConnectNativeStickerBubble body={f.text} colors={colors}/>:
              Boolean(f.text)&&<Text style={{fontSize:15,color:textColor}}>{f.text.startsWith('[[')?'Формат сообщения ещё не поддерживается':f.text}</Text>}
          </>}
          <Text style={{color:mutedColor,fontSize:10,textAlign:'right',marginTop:5}}>{time(item.created_at)}{item.edited_at?' · изм.':''}</Text>
        </Pressable>;
      }}/>
    {Boolean(reply||edit)&&<View style={{paddingHorizontal:12,paddingVertical:5,backgroundColor:colors.surface,flexDirection:'row',alignItems:'center',gap:8}}>
      <Text numberOfLines={1} style={{flex:1,color:colors.accent,fontSize:12}}>{edit?'Редактирование':`Ответ: ${reply?.body||reply?.attachment_name||'вложение'}`}</Text>
      <Btn name="close" colors={colors} label="Отмена" onPress={()=>{setReply(null);setEdit(null);setDraft('');}}/>
    </View>}
    {stickerPickerOpen&&<ConnectNativeStickerPicker colors={colors} ownerId={ownerId} busy={busy||uploading}
      onClose={()=>setStickerPickerOpen(false)} onEmoji={emoji=>setDraft(text=>text+emoji)} onSend={sendSticker}/>}
    <View style={{flexDirection:'row',alignItems:'center',padding:8,borderTopWidth:.6,borderTopColor:colors.line,gap:2}}>
      <Btn name="happy-outline" colors={colors} label="Стикеры и эмодзи" disabled={uploading||recorderState.isRecording}
        onPress={()=>{Keyboard.dismiss();setStickerPickerOpen(open=>!open);}}/>
      <Btn name="attach-outline" colors={colors} label="Прикрепить" onPress={showAttachmentMenu} disabled={uploading||busy}/>
      <Btn name="radio-button-on-outline" colors={colors} label="Записать видеокружок" onPress={()=>setVideoNoteOpen(true)} disabled={uploading||busy||recorderState.isRecording}/>
      <TextInput multiline maxLength={10000} placeholder={uploading?'Отправка файла…':'Сообщение'} placeholderTextColor={mutedColor}
        value={draft} onChangeText={setDraft} style={{backgroundColor:colors.surface,color:textColor,borderRadius:16,paddingHorizontal:12,paddingVertical:10,fontSize:15,maxHeight:110,flex:1}}/>
      {Boolean(draft.trim())?<Btn name="send" colors={colors} label="Отправить" disabled={busy} onPress={()=>void submit()}/>
      :<Btn name={recorderState.isRecording?'stop-circle':'mic-outline'} colors={colors}
        label={recorderState.isRecording?'Остановить и отправить запись':'Записать голосовое'} onPress={()=>void toggleRecord()}/>}
    </View>
    {recorderState.isRecording&&<Text style={{color:colors.danger,textAlign:'center',padding:5}}>● Идёт запись — нажми Стоп для отправки</Text>}
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
