const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const ts=require('typescript');
const conversationId='11111111-1111-4111-8111-111111111111';
const older='2026-11-09T10:00:00.000Z',newer='2026-11-09T10:01:00.000Z';
function harness(notifications=[]){
  const cancelled=[],displayed=[],stored=new Map(),nativeMissed=[],ended=[];
  const notifee={getDisplayedNotifications:async()=>notifications.map(notification=>({notification})),cancelNotification:async id=>{cancelled.push(id);},
    displayNotification:async notification=>{
      displayed.push(notification);
      const old=notifications.findIndex(item=>item.id===notification.id);
      if(old>=0)notifications.splice(old,1);
      notifications.push(notification);
    }};
  const secureStore={getItemAsync:async key=>stored.get(key)||null,setItemAsync:async(key,value)=>{
    assert.match(key,/^[A-Za-z0-9._-]+$/);
    await new Promise(resolve=>setImmediate(resolve));stored.set(key,value);
  }};
  const stubs={'react-native':{AppState:{},NativeModules:{ConnectCallCoordinator:{receiveMissed:async payload=>nativeMissed.push(JSON.parse(payload))}}},'@react-native-firebase/messaging':{},'@notifee/react-native':{__esModule:true,default:notifee,AndroidCategory:{MESSAGE:'msg'},AndroidImportance:{HIGH:4},AndroidVisibility:{PRIVATE:0}},'expo-secure-store':secureStore,'./backend':{},'./ConnectNativeTelecom':{endSystemCall:async id=>ended.push(id)},'./ConnectNativeSoundSettings':{getConnectSoundChannel:async()=> 'messages'}};
  const source=readFileSync(path.join(__dirname,'../src/ConnectNativePush.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const exports={};vm.runInNewContext(compiled,{exports,require:name=>stubs[name],process:{env:{}},console,Map,Date,Promise});
  return {push:exports,cancelled,stored,displayed,nativeMissed,ended};
}
function alert(id,kind,createdAt){return {id,data:{conversationId,kind,createdAt}};}
test('a read receipt preserves the newer message alert and incoming calls',async()=>{
  const h=harness([alert('chat:'+conversationId,'message',newer),alert('call:live','incoming-call',older),alert('legacy-read-message','message',older)]);
  await h.push.dismissChatPush(conversationId,older);
  assert.deepEqual(h.cancelled,['legacy-read-message']);
});
test('a fully read chat clears message alerts without clearing its call alert',async()=>{
  const h=harness([alert('chat:'+conversationId,'message',older),alert('call:live','incoming-call',older)]);
  await h.push.dismissChatPush(conversationId,newer);
  assert.deepEqual(h.cancelled,['chat:'+conversationId]);
});
test('missing notification timestamps are never assumed read',async()=>{
  const h=harness([alert('chat:'+conversationId,'message','')]);
  await h.push.dismissChatPush(conversationId,newer);
  assert.deepEqual(h.cancelled,[]);
});
test('overlapping read receipts keep the greatest timestamp in valid SecureStore keys',async()=>{
  const h=harness();
  await Promise.all([h.push.rememberReadAt(conversationId,newer),h.push.rememberReadAt(conversationId,older)]);
  assert.equal([...h.stored.values()][0],newer);
});
test('an older FCM push cannot replace a newer unread notification',async()=>{
  const h=harness();h.stored.set('connect-native-fcm-authorized-v1','yes');
  await h.push.handleNativePush({kind:'message',conversationId,createdAt:newer,messageId:'new'});
  await h.push.handleNativePush({kind:'message',conversationId,createdAt:older,messageId:'old'});
  await h.push.dismissChatPush(conversationId,older);
  assert.equal(h.displayed.length,1);
  assert.equal(h.displayed[0].data.messageId,'new');
  assert.equal(h.cancelled.length,0);
});
test('duplicate FCM delivery does not ring twice',async()=>{
  const h=harness();h.stored.set('connect-native-fcm-authorized-v1','yes');
  const message={kind:'message',conversationId,createdAt:newer,messageId:'same'};
  await Promise.all([h.push.handleNativePush(message),h.push.handleNativePush(message)]);
  assert.equal(h.displayed.length,1);
});

test('missed-call payload goes to native durable owner without JS message/call notification',async()=>{
 const h=harness(),data={kind:'missed-call',callId:conversationId,userId:conversationId,conversationId,endedAt:newer};
 await h.push.handleNativePush(data);assert.equal(h.nativeMissed.length,1);assert.equal(h.nativeMissed[0].kind,'missed-call');assert.equal(h.displayed.length,0);
 await h.push.handleNativePush({kind:'call-ended',callId:conversationId});assert.deepEqual(h.ended,[conversationId]);assert.deepEqual(h.cancelled,[]);
});
test('reading chat never removes persistent missed-call notifications',async()=>{
 const h=harness([alert('chat:'+conversationId,'message',older),alert('connect-missed:owner:call','missed-call',older)]);
 await h.push.dismissChatPush(conversationId,newer);assert.deepEqual(h.cancelled,['chat:'+conversationId]);
});
