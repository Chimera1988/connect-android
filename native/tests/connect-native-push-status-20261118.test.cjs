'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const owner='11111111-1111-4111-8111-111111111111';
function harness({status=1,enabled=true,serverEnabled=true,token='valid-FCM-token-'.repeat(8),serverOk=true,serverError=false,userId=owner}={}){
 const requests=[],saved=new Map(),notifications={getNotificationSettings:async()=>({authorizationStatus:status}),requestPermission:async()=>({authorizationStatus:status})};
 if(enabled===false)saved.set('connect-native-notifications-v1',JSON.stringify({enabled:false,sound:'soft',vibrate:true}));
 const db={auth:{getSession:async()=>({data:{session:{user:{id:userId},access_token:'fake-access-token-for-test'}}})},from:table=>{
   assert.equal(table,'notification_preferences');return {select:column=>{assert.equal(column,'enabled');return {eq:(_key,id)=>{assert.equal(id,owner);return {maybeSingle:async()=>({data:{enabled:serverEnabled},error:serverError?Error('offline'):null})};}};}};
 }};
 const stubs={
  'react-native':{AppState:{currentState:'active'},NativeModules:{},DeviceEventEmitter:{}},
  '@react-native-firebase/messaging':{getMessaging:()=>({}),getToken:async()=>token},
  '@notifee/react-native':{__esModule:true,default:notifications,AndroidCategory:{},AndroidImportance:{},AndroidVisibility:{},EventType:{}},
  'expo-secure-store':{getItemAsync:async k=>saved.get(k)||null,setItemAsync:async(k,v)=>{saved.set(k,v);}},
  './backend':{db},'../web/lib/chat-order':{chatTimeKey:x=>x},
  './ConnectNativeTelecom':{},'./ConnectNativeSoundSettings':{},
  '../web/lib/android-sound-policy':{NOTIFICATION_KEY:'connect-native-notifications-v1',parseNotificationPrefs:v=>v&&typeof v.enabled==='boolean'?v:{enabled:true,sound:'soft',vibrate:true},mergeServerNotificationPrefs:()=>({})},
 };
 const code=ts.transpileModule(read('src/ConnectNativePush.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const output={};const sandbox={exports:output,require:n=>{assert.ok(Object.hasOwn(stubs,n),'Missing mock for '+n);return stubs[n];},Promise,Date,Map,Set,console,process:{env:{}},fetch:async(url,options)=>{requests.push({url,method:options.method,body:JSON.parse(options.body),authorized:options.headers.Authorization?.startsWith('Bearer ')});return {ok:serverOk,status:serverOk?200:503};}};
 vm.runInNewContext(code,sandbox);
 return {push:output,requests,saved};
}
test('active means current FCM token received a fresh authenticated server registration acknowledgement',async()=>{
 const h=harness();const s=await h.push.getNativePushSubscriptionStatus(owner);
 assert.equal(s.state,'active');assert.ok(Number.isFinite(Date.parse(s.verifiedAt)));
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'POST');assert.ok(h.requests[0].authorized);
 assert.equal(h.requests[0].body.platform,'android');assert.ok(h.requests[0].body.endpoint.length>32);
 assert.ok(!JSON.stringify(s).includes(h.requests[0].body.endpoint),'FCM token must not cross bridge');
 assert.equal(h.saved.get('connect-native-fcm-authorized-v1'),'yes');
});
test('Android permission denial never becomes a green subscription',async()=>{
 const h=harness({status:0});const s=await h.push.getNativePushSubscriptionStatus(owner);
 assert.equal(s.state,'permission');assert.equal(h.requests.length,0);
});
test('disabled local preference never reports an active subscription',async()=>{
 const h=harness({enabled:false});const s=await h.push.getNativePushSubscriptionStatus(owner);
 assert.equal(s.state,'disabled');assert.equal(h.requests.length,0);
});
test('disabled server notification preference never reports active',async()=>{
 const h=harness({serverEnabled:false});const s=await h.push.getNativePushSubscriptionStatus(owner);
 assert.equal(s.state,'disabled');assert.equal(h.requests.length,0);
});
test('FCM token unavailable is distinguishable from network outage',async()=>{
 const h=harness({token:''});const s=await h.push.getNativePushSubscriptionStatus(owner);
 assert.equal(s.state,'unregistered');assert.equal(h.requests.length,0);
});
test('server rejection or network failure never masquerades as active',async()=>{
 for(const o of [{serverOk:false},{serverError:true},{userId:'22222222-2222-4222-8222-222222222222'}]){
  const h=harness(o);const s=await h.push.getNativePushSubscriptionStatus(owner);
  assert.equal(s.state,'temporary');assert.equal(s.verifiedAt,undefined);
 }
});
test('security: Android bridge accepts only three empty-payload notification status commands',()=>{
 const p=read('src/hybridProtocol.ts'),a=read('src/App.tsx'),ui=read('web/components/ConnectNativePushStatus.tsx');
 assert.match(p,/case 'notification:status':case 'notification:connect':case 'notification:test':return fields\(value,\[\]\)/);
 for(const c of ['status','connect','test']){assert.match(p,new RegExp("'notification:"+c+"'"));assert.match(a,new RegExp("case 'notification:"+c+"'"));}
 assert.match(p,/isTrustedHybridUrl\(sourceUrl\)/);
 assert.doesNotMatch(ui,/fetch\(|getToken|FCM-token|service_role|SERVICE_ROLE/);
 assert.match(ui,/Подписка активна/);assert.match(ui,/Подключить уведомления/);
 assert.match(ui,/server|сервер/);
});
test('automated recovery on foreground/resume and token rotation has retry pacing and teardown',()=>{
 const p=read('src/ConnectNativePush.ts');
 assert.match(p,/setInterval\(\(\)=>\{void repair\(\);\},15\*60\*1000\)/);
 assert.match(p,/if\(state==='active'\)\{void drainOpen\(\);void repair\(\);\}/);
 assert.match(p,/getNotificationSettings\(\)/);
 assert.match(p,/sendRegistration\(token,'POST',ownerId\)/);
 assert.match(p,/scheduleRetry\(\)/);
 assert.match(p,/clearInterval\(periodic\)/);
});
test('all reviewed modified sources and new status component are included in the SHA-256 lock',()=>{
 const lock=JSON.parse(read('PARITY_SOURCE_LOCK.json'));
 for(const p of ['src/ConnectNativePush.ts','src/App.tsx','src/hybridProtocol.ts','web/components/ConnectNotificationSettings.tsx','web/components/ConnectNativePushStatus.tsx','tests/connect-native-push-status-20261118.test.cjs'])
  assert.equal(lock.files[p],crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex'),p);
 assert.ok(Object.keys(lock.files).length>=379);
});
