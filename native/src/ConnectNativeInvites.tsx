/** Connect Native invitation flows using the same Connect PWA server endpoints.
 * Invite tokens are redeemed by the server; no service_role key is shipped in this app.
 */
import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Modal,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {db} from './backend';
import type {Palette} from './theme';

const API=(process.env.EXPO_PUBLIC_CONNECT_URL||'https://connect-chat.duckdns.org').replace(/\/$/,'');
export type InvitationMode='register'|'admin';
type Invite={id:string;email:string;created_at:string;expires_at:string;redeemed_at:string|null;revoked_at:string|null};
type InviteResult={error?:string;admin?:boolean;email?:string;code?:string;invitations?:Invite[]};

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

export default function ConnectNativeInvites({visible,mode,colors,onClose}:{visible:boolean;mode:InvitationMode;colors:Palette;onClose:()=>void}){
  const [code,setCode]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [email,setEmail]=useState('');
  const [issued,setIssued]=useState('');
  const [invites,setInvites]=useState<Invite[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    try {const result=await request('/api/admin/invite','GET',undefined,true);setInvites(result.invitations||[]);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{
    if(!visible)return;
    setError('');setIssued('');setCode('');setPassword('');setConfirm('');
    if(mode==='admin')void load();
  },[visible,mode,load]);
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
      const result=await request('/api/admin/invite','POST',{email:email.trim()},true);
      if(!result.code)throw Error('Сервер не вернул код приглашения');
      setIssued(result.code);await load();
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
  return <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={()=>{if(!busy)onClose();}}>
    <View style={{flex:1,backgroundColor:'rgba(0,0,0,.76)',padding:16,justifyContent:'center'}}>
      <View style={card}>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <Text style={{color:colors.text,fontSize:20,fontWeight:'800',flex:1}}>{mode==='admin'?'Приглашения Connect':'Регистрация по коду'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={()=>{if(!busy)onClose();}} style={{padding:9}}>
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
            <Text style={{color:colors.muted,fontSize:13,marginTop:11}}>Одноразовый код на 24 часа для email нового участника.</Text>
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
            </View>}
            <Text style={{color:colors.text,fontSize:16,fontWeight:'700',marginTop:22,marginBottom:8}}>Последние приглашения</Text>
            {loading&&<ActivityIndicator color={colors.accent}/>}
            {invites.map(item=>{
              const active=!item.redeemed_at&&!item.revoked_at&&Date.parse(item.expires_at)>Date.now();
              const status=item.redeemed_at?'Использован':item.revoked_at?'Отозван':active?'Активен':'Истёк';
              return <View key={item.id} style={{paddingVertical:11,borderBottomWidth:1,borderBottomColor:colors.line}}>
                <Text style={{color:colors.text,fontSize:14}}>{item.email}</Text>
                <Text style={{color:colors.muted,fontSize:12,marginTop:3}}>{status} · до {new Date(item.expires_at).toLocaleString('ru-RU')}</Text>
                {active&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void revoke(item.id)} style={{marginTop:8}}><Text style={{color:colors.danger}}>Отозвать</Text></Pressable>}
              </View>;
            })}
          </>}
          {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger,fontSize:13,marginTop:12}}>{error}</Text>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
