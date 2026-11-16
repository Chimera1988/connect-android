const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const ts=require('typescript');
const conversationId='11111111-1111-4111-8111-111111111111';
const older='2026-11-09T10:00:00.000Z',newer='2026-11-09T10:01:00.000Z';
function harness(notifications=[]){
  const cancelled=[],displayed=[],stored=new Map(),nativeMissed=[],ended=[],soundChoices=[];
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
  const stubs={'react-native':{AppState:{},NativeModules:{ConnectCallCoordinator:{receiveMissed:async payload=>nativeMissed.push(JSON.parse(payload))}}},'@react-native-firebase/messaging':{},'@notifee/react-native':{__esModule:true,default:notifee,AndroidCategory:{MESSAGE:'msg'},AndroidImportance:{HIGH:4},AndroidVisibility:{PRIVATE:0}},'expo-secure-store':secureStore,'./backend':{},'./ConnectNativeTelecom':{endSystemCall:async id=>ended.push(id)},'./ConnectNativeSoundSettings':{getConnectSoundChannel:async(kind,options)=>{soundChoices.push({kind,options});return 'messages';}}};
  const policy={};vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname,'../web/lib/android-sound-policy.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{exports:policy});stubs['../web/lib/android-sound-policy']=policy;
  const order={};vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname,'../web/lib/chat-order.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{exports:order});stubs['../web/lib/chat-order']=order;
  const source=readFileSync(path.join(__dirname,'../src/ConnectNativePush.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  let clockTime=Date.parse('2026-11-15T12:00:00Z');class ClockDate extends Date{constructor(value){super(arguments.length?value:clockTime);}}
  const exports={};vm.runInNewContext(compiled,{exports,require:name=>stubs[name],process:{env:{}},console,Map,Date:ClockDate,Promise});
  return {push:exports,cancelled,stored,displayed,nativeMissed,ended,soundChoices,notifee,notifications,setClock:value=>clockTime=value};
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
test('Postgres microsecond boundaries never clear a newer message within the same millisecond',async()=>{
  const read='2026-11-15T10:00:00.000100Z',unread='2026-11-15T10:00:00.000200Z';
  const h=harness([alert('chat:'+conversationId,'message',unread)]);
  await h.push.dismissChatPush(conversationId,read);assert.equal(h.cancelled.length,0);
  await h.push.rememberReadAt(conversationId,unread);await h.push.rememberReadAt(conversationId,read);
  assert.equal(h.stored.get('connect-native-read-marker-v1-'+conversationId),unread);
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
test('damaged local markers cannot block later reads or message delivery',async()=>{
  const h=harness();h.stored.set('connect-native-fcm-authorized-v1','yes');
  h.stored.set('connect-native-shown-message-v1-'+conversationId,'{broken');
  h.stored.set('connect-native-read-marker-v1-'+conversationId,'invalid');
  await h.push.rememberReadAt(conversationId,older);
  assert.equal(h.stored.get('connect-native-read-marker-v1-'+conversationId),older);
  await h.push.handleNativePush({kind:'message',conversationId,createdAt:newer,messageId:'new'});
  assert.equal(h.displayed.length,1);
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
test('notification diagnostics contain stages and times, never payload text or tokens',async()=>{
  const h=harness();h.stored.set('connect-native-fcm-authorized-v1','yes');
  await h.push.handleNativePush({kind:'message',conversationId,createdAt:older,messageId:'safe',body:'PRIVATE',token:'SECRET'});
  await h.push.rememberReadAt(conversationId,newer);await h.push.dismissChatPush(conversationId,newer);
  const log=h.stored.get('connect-native-push-trace-v1');assert(log);
  assert(!log.includes('PRIVATE'));assert(!log.includes('SECRET'));
  const events=JSON.parse(log);for(const stage of ['received','shown','read','dismissed'])assert(events.some(e=>e.stage===stage));
  assert(events.every(e=>Number.isFinite(Date.parse(e.at))));
});
test('duplicate FCM after swipe or process restart does not resurrect the alert',async()=>{
  const h=harness();h.stored.set('connect-native-fcm-authorized-v1','yes');
  const message={kind:'message',conversationId,createdAt:newer,messageId:'persisted'};
  await h.push.handleNativePush(message);h.notifications.length=0;
  const restarted=harness();for(const [k,v] of h.stored)restarted.stored.set(k,v);
  await restarted.push.handleNativePush(message);
  assert.equal(restarted.displayed.length,0);
});
test('read cancellation cannot erase a concurrently arriving newer message',async()=>{
  const h=harness([alert('chat:'+conversationId,'message',older)]);
  h.stored.set('connect-native-fcm-authorized-v1','yes');
  let release,entered;const started=new Promise(r=>entered=r);
  h.notifee.cancelNotification=async id=>{entered();await new Promise(r=>release=r);h.cancelled.push(id);h.notifications.splice(0,1);};
  const read=h.push.dismissChatPush(conversationId,older);await started;
  const arrival=h.push.handleNativePush({kind:'message',conversationId,createdAt:newer,messageId:'new'});
  await new Promise(r=>setImmediate(r));release();await Promise.all([read,arrival]);
  assert.equal(h.notifications.length,1);assert.equal(h.notifications[0].data.messageId,'new');
});
test('reading one chat removes its message summary but preserves another chat and missed calls',async()=>{
  const second='22222222-2222-4222-8222-222222222222';
  const h=harness([alert('child','message',older),{id:'summary',data:{kind:'message-summary',conversationId},android:{groupSummary:true}},
    {id:'second',data:{kind:'message',conversationId:second,createdAt:older}},alert('missed','missed-call',older)]);
  await h.push.dismissChatPush(conversationId,newer);
  assert.deepEqual(h.cancelled,['child','summary']);
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

test('message handler shared by foreground and headless FCM honors default, alternatives and silence',async()=>{
 for(const tone of ['soft','bright','gentle','legacy-soft','silent']){
  const h=harness();h.stored.set('connect-native-fcm-authorized-v1','yes');h.stored.set('connect-native-notifications-v1',JSON.stringify({enabled:true,vibrate:false,sound:tone}));
  await h.push.handleNativePush({kind:'message',conversationId,createdAt:newer,messageId:'sound-'+tone});
  assert.equal(h.displayed.length,1);assert.equal(h.soundChoices.length,1);assert.equal(h.soundChoices[0].options.tone,tone);assert.equal(h.soundChoices[0].options.silent,tone==='silent');assert.equal(h.soundChoices[0].options.vibrate,false);
 }
});

test('receipt timestamp records handler entry rather than delayed diagnostic storage work',async()=>{
 const h=harness();const entry='2026-11-15T12:00:00.000Z';h.setClock(Date.parse(entry));
 const pending=h.push.handleNativePush({kind:'ignored'});h.setClock(Date.parse(entry)+10000);await pending;
 assert.equal(JSON.parse(h.stored.get('connect-native-push-trace-v1'))[0].at,entry);
});
