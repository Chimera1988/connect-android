/** Connect Native password creation after verified Supabase recovery/invite callback.
 * Do not read/log recovery tokens here: only the Supabase-authenticated session
 * can update the password. HTTPS link routing must be set up server-side.
 */
import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Modal,Pressable,Text,TextInput,View} from 'react-native';
import {db} from './backend';
import type {Palette} from './theme';

export default function ConnectNativePasswordSetup({visible,onClose,colors}:{visible:boolean;onClose:()=>void;colors:Palette}){
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{if(visible){setPassword('');setConfirm('');setError('');}},[visible]);
  async function submit(){
    if(busy)return;
    if(password.length<8||password.length>128){setError('Пароль должен содержать от 8 до 128 символов.');return;}
    if(password!==confirm){setError('Пароли не совпадают.');return;}
    setBusy(true);setError('');
    try{
      const {data:{session}}=await db.auth.getSession();
      if(!session)throw new Error('Сессия истекла. Откройте ссылку ещё раз.');
      const {error:saveError}=await db.auth.updateUser({password});
      if(saveError)throw saveError;
      setPassword('');setConfirm('');
      onClose();
      Alert.alert('Connect','Новый пароль сохранён.');
    }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить пароль');}
    finally{setBusy(false);}
  }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={()=>{if(!busy)onClose();}}>
    <View style={{flex:1,backgroundColor:'#000b',justifyContent:'center',padding:18}}>
      <View style={{backgroundColor:colors.surface,borderRadius:20,borderWidth:1,borderColor:colors.line,padding:20,gap:13}}>
        <Text style={{color:colors.text,fontWeight:'800',fontSize:22}}>Установить пароль Connect</Text>
        <Text style={{color:colors.muted,fontSize:13}}>Подтверждение ссылки получено. Придумайте пароль для аккаунта.</Text>
        <TextInput secureTextEntry textContentType="newPassword" autoCapitalize="none" autoCorrect={false}
          value={password} onChangeText={setPassword} placeholder="Новый пароль" placeholderTextColor={colors.muted}
          style={{color:colors.text,borderColor:colors.line,borderWidth:1,borderRadius:13,padding:13}}/>
        <TextInput secureTextEntry textContentType="newPassword" autoCapitalize="none" autoCorrect={false}
          value={confirm} onChangeText={setConfirm} placeholder="Повторите пароль" placeholderTextColor={colors.muted}
          style={{color:colors.text,borderColor:colors.line,borderWidth:1,borderRadius:13,padding:13}}/>
        {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void submit()}
          style={{backgroundColor:colors.accent,padding:14,borderRadius:13,alignItems:'center',opacity:busy?0.6:1}}>
          {busy?<ActivityIndicator color={colors.bg}/>:<Text style={{color:colors.bg,fontWeight:'800'}}>Сохранить пароль</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={{alignItems:'center',padding:9}}>
          <Text style={{color:colors.muted}}>Отмена</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}
