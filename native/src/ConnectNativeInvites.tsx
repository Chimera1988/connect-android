/** Connect Native invitation flows using the same Connect PWA server endpoints.
 * Invite tokens are redeemed by the server; no service_role key is shipped in this app.
 */
import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Modal,Pressable,ScrollView,Share,Text,TextInput,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {db} from './backend';
import type {Palette} from './theme';

const API=(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'');
export type InvitationMode='register'|'admin';
type InviteKind='normal'|'hidden';
type Invite={id:string;email:string;created_at:string;expires_at:string;redeemed_at:string|null;revoked_at:string|null;invite_type?:InviteKind};
type Member={id:string;display_name:string;is_hidden:boolean};
type InviteResult={error?:string;admin?:boolean;email?:string;code?:string;invitations?:Invite[];members?:Member[];ok?:boolean};

async function request(path:string,method:'GET'|'POST'|'DELETE',body?:object,authenticated=false):Promise<InviteResult>{
  let token:string|undefined;
  if(authenticated){
    const {data:{session}}=await db.auth.getSession();
    if(!session)throw Error('Войдите в аккаунт Connect');
    token=session.access_token;
  }
  const res=await fetch(API+path,{
    method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const value=await res.json().catch(()=>({error:'Сервер Connect не ответил'})) as InviteResult;
  if(!res.ok)throw Error(value.error||`Ошибка HTTP ${res.status}`);
  return value;
}
export async function hasInviteAdminAccess():Promise<boolean>{
  try { const response=await request('/api/admin/invite','GET',undefined,true);return response.admin===true; }
  catch { return false; }
}

export default function ConnectNativeInvites({visible,mode,colors,onClose,onMembersChanged}:{visible:boolean;mode:InvitationMode;colors:Palette;onClose:()=>void;onMembersChanged?:()=>void|Promise<void>}){
  const [code,setCode]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [email,setEmail]=useState('');
  const [issued,setIssued]=useState('');
  const [issuedFor,setIssuedFor]=useState('');
  const [inviteKind,setInviteKind]=useState<InviteKind>('normal');
  const [invites,setInvites]=useState<Invite[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [memberError,setMemberError]=useState('');
  const [membersLoading,setMembersLoading]=useState(false);
  const [changingMember,setChangingMember]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    try {const result=await request('/api/admin/invite','GET',undefined,true);setInvites(result.invitations||[]);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  },[]);
  const loadMembers=useCallback(async()=>{
    setMembersLoading(true);setMemberError('');
    try{const result=await request('/api/admin/hidden-members','GET',undefined,true);setMembers(result.members||[]);}
    catch(e){setMemberError(e instanceof Error?e.message:String(e));}
    finally{setMembersLoading(false);}
  },[]);
  useEffect(()=>{
    if(!visible)return;
    setError('');setIssued('');setIssuedFor('');setInviteKind('normal');setCode('');setPassword('');setConfirm('');
    if(mode==='admin'){setMembers([]);setInvites([]);void load();void loadMembers();}
  },[visible,mode,load,loadMembers]);
  async function toggleHidden(member:Member){
    if(changingMember)return;
    setChangingMember(member.id);setMemberError('');
    try{
      await request('/api/admin/hidden-members','POST',{user_id:member.id,hidden:!member.is_hidden},true);
      setMembers(old=>old.map(item=>item.id===member.id?{...item,is_hidden:!member.is_hidden}:item));
      if(onMembersChanged)await onMembersChanged();
    }catch(e){setMemberError(e instanceof Error?e.message:String(e));}
    finally{setChangingMember('');}
  }
  async function redeem(){
    if(busy)return;
    if(!code.trim()||password.length<8||password.length>128){setError('Введите код и пароль от 8 до 128 символов');return;}
    if(password!==confirm){setError('Пароли не совпадают');return;}
    setBusy(true);setError('');
    try{
      const result=await request('/api/invite/redeem','POST',{code:code.trim(),password});
      setCode('');setPassword('');setConfirm('');onClose();
      Alert.alert('Регистрация завершена',`Аккаунт ${result.email||''} создан. Теперь войдите с этим паролем.`);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function create(){
    if(busy)return;
    if(!/^\S+@\S+\.\S+$/.test(email.trim())){setError('Введите корректный email');return;}
    setBusy(true);setError('');
    try{
      const recipient=email.trim();
      const result=await request('/api/admin/invite','POST',{email:recipient,invite_type:inviteKind},true);
      if(!result.code)throw Error('Сервер не вернул код приглашения');
      setIssued(result.code);setIssuedFor(recipient);await load();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function revoke(id:string){
    if(busy)return;
    setBusy(true);setError('');
    try{await request('/api/admin/invite','DELETE',{id},true);await load();}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  const field={minHeight:48,backgroundColor:colors.surface,borderRadius:13,borderWidth:1,borderColor:colors.line,
    paddingHorizontal:13,paddingVertical:10,color:colors.text,fontSize:16,marginTop:10} as const;
  const button={minHeight:44,backgroundColor:colors.accent,borderRadius:13,alignItems:'center',justifyContent:'center',marginTop:12} as const;
  const card={backgroundColor:colors.elevated,borderWidth:1,borderColor:colors.line,borderRadius:22,padding:18,
    maxHeight:'86%',width:'100%'} as const;
  return <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={()=>{if(!busy&&!changingMember)onClose();}}>
    <View style={{flex:1,backgroundColor:'rgba(0,0,0,.76)',padding:16,justifyContent:'center'}}>
      <View style={card}>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <Text style={{color:colors.text,fontSize:20,fontWeight:'800',flex:1}}>{mode==='admin'?'Приглашения Connect':'Регистрация по коду'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={()=>{if(!busy&&!changingMember)onClose();}} style={{padding:9}}>
            <Text style={{color:colors.accent,fontSize:16}}>Закрыть ×</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:12}}>
          {mode==='register'?<>
            <Text style={{color:colors.muted,fontSize:13,marginTop:11}}>Введите одноразовый код приглашения и придумайте пароль. Email уже привязан к коду.</Text>
            <TextInput style={field} placeholder="Код приглашения" placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} value={code} onChangeText={setCode}/>
            <TextInput style={field} placeholder="Пароль (от 8 символов)" placeholderTextColor={colors.muted} autoCapitalize="none" secureTextEntry value={password} onChangeText={setPassword}/>
            <TextInput style={field} placeholder="Повторите пароль" placeholderTextColor={colors.muted} autoCapitalize="none" secureTextEntry value={confirm} onChangeText={setConfirm}/>
            <Pressable disabled={busy} onPress={()=>void redeem()} style={[button,busy&&{opacity:.6}]} accessibilityRole="button">
              <Text style={{color:'#05202a',fontWeight:'800'}}>{busy?'Создание аккаунта…':'Создать аккаунт'}</Text>
            </Pressable>
          </>:<>
            <View accessibilityRole="tablist" style={{flexDirection:'row',gap:8,marginTop:12}}>
              {(['normal','hidden'] as const).map(kind=><Pressable key={kind} accessibilityRole="tab" accessibilityState={{selected:inviteKind===kind,disabled:busy}} disabled={busy}
                onPress={()=>{setInviteKind(kind);setIssued('');setIssuedFor('');setError('');}}
                style={{flex:1,padding:11,borderRadius:12,borderWidth:1,borderColor:inviteKind===kind?colors.accent:colors.line,backgroundColor:inviteKind===kind?colors.elevated:colors.surface}}>
                <Text style={{color:colors.text,textAlign:'center',fontWeight:'700'}}>{kind==='hidden'?'Коды для скрытых':'Обычные коды'}</Text>
              </Pressable>)}
            </View>
            <Text style={{color:colors.muted,fontSize:13,marginTop:11}}>{inviteKind==='hidden'?'Этот код создаст скрытого участника. В его контактах будет только администратор. Код действует 24 часа.':'Одноразовый код на 24 часа для email нового участника.'}</Text>
            <TextInput style={field} placeholder="Email нового пользователя" placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail}/>
            <Pressable disabled={busy} onPress={()=>void create()} style={[button,busy&&{opacity:.6}]} accessibilityRole="button">
              <Text style={{color:'#05202a',fontWeight:'800'}}>{busy?'Создаём…':'Создать код'}</Text>
            </Pressable>
            {!!issued&&<View style={{padding:12,marginTop:13,backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:colors.accent}}>
              <Text style={{color:colors.muted,fontSize:12}}>Новый код приглашения</Text>
              <Text selectable style={{color:colors.text,fontSize:17,fontWeight:'800',marginVertical:8}}>{issued}</Text>
              <Pressable accessibilityRole="button" onPress={()=>void Clipboard.setStringAsync(issued)}>
                <Text style={{color:colors.accent}}>Скопировать код</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={()=>void Share.share({
                title:'Приглашение в Connect',
                message:`Приглашение в Connect\nКод: ${issued}\nДля: ${issuedFor}\nКод действителен 24 часа.`,
              }).catch(e=>{setError(e instanceof Error?e.message:'Не удалось поделиться приглашением');})}
                style={{marginTop:12,paddingVertical:8}}>
                <Text style={{color:colors.accent,fontWeight:'700'}}>Поделиться приглашением</Text>
              </Pressable>
            </View>}
            <Text style={{color:colors.text,fontSize:16,fontWeight:'700',marginTop:22,marginBottom:8}}>Последние приглашения</Text>
            {loading&&<ActivityIndicator color={colors.accent}/>}
            {invites.filter(item=>(item.invite_type||'normal')===inviteKind).map(item=>{
              const active=!item.redeemed_at&&!item.revoked_at&&Date.parse(item.expires_at)>Date.now();
              const status=item.redeemed_at?'Использован':item.revoked_at?'Отозван':active?'Активен':'Истёк';
              return <View key={item.id} style={{paddingVertical:11,borderBottomWidth:1,borderBottomColor:colors.line}}>
                <Text style={{color:colors.text,fontSize:14}}>{item.email}</Text>
                <Text style={{color:colors.muted,fontSize:12,marginTop:3}}>{status} · до {new Date(item.expires_at).toLocaleString('ru-RU')}</Text>
                {active&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void revoke(item.id)} style={{marginTop:8}}><Text style={{color:colors.danger}}>Отозвать</Text></Pressable>}
              </View>;
            })}
            <Text style={{color:colors.text,fontSize:16,fontWeight:'700',marginTop:24,marginBottom:8}}>Статусы участников</Text>
            <Text style={{color:colors.muted,fontSize:12,marginBottom:8}}>Скрытый участник видит только администратора. Изменения не удаляют переписки.</Text>
            {membersLoading?<ActivityIndicator color={colors.accent}/>:!members.length&&!memberError?<Text style={{color:colors.muted}}>Пока нет других участников.</Text>:members.map(member=><View key={member.id} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:11,borderBottomWidth:1,borderBottomColor:colors.line}}>
              <View style={{flex:1}}><Text style={{color:colors.text,fontWeight:'600'}}>{member.display_name||'Без имени'}</Text><Text style={{color:colors.muted,fontSize:12,marginTop:3}}>{member.is_hidden?'Скрытый':'Обычный'}</Text></View>
              <Pressable accessibilityRole="button" disabled={Boolean(changingMember)} onPress={()=>void toggleHidden(member)} style={{padding:10,borderWidth:1,borderColor:colors.line,borderRadius:11,opacity:changingMember ? .6 : 1}}>
                <Text style={{color:colors.accent,fontSize:12}}>{changingMember===member.id?'Сохраняем…':member.is_hidden?'Сделать обычным':'Скрыть'}</Text>
              </Pressable>
            </View>)}
            {!!memberError&&<View style={{gap:8,marginTop:10}}><Text accessibilityRole="alert" style={{color:colors.danger,fontSize:12}}>{memberError}</Text><Pressable accessibilityRole="button" onPress={()=>void loadMembers()}><Text style={{color:colors.accent}}>Загрузить участников снова</Text></Pressable></View>}
          </>}
          {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger,fontSize:13,marginTop:12}}>{error}</Text>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
