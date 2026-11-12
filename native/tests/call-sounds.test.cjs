const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function loadPolicy(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../web/lib/android-sound-policy.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports});return exports;}
function fixture(){
 const records=new Map(),played=[],channels=[],created=[],existing=new Map(),state={currentState:'active'};
 let vibration=true,stops=0,read=async k=>records.get(k)||null;
 const native={previewSound:async uri=>{played.push(uri);return true;},stopPreviewSound:async()=>{stops++;},importSound:async()=> 'content://media/external/audio/media/17'};
 const secure={getItemAsync:k=>read(k),setItemAsync:async(k,v)=>records.set(k,v),deleteItemAsync:async k=>records.delete(k)};
 const notifee={getChannel:async id=>existing.get(id),createChannel:async c=>{created.push(c);existing.set(c.id,{...c});}};
 const deps={'react':{},'react-native':{AppState:state,Platform:{OS:'android'},NativeModules:{ConnectSoundModule:native,ConnectCallCoordinator:{getCallVibration:async()=>vibration,configureSounds:async(...args)=>{channels.push(args);return 'native-calls'}}}},'expo-document-picker':{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'content://provider/sound',name:'Моя мелодия.m4a',size:128}]})},'expo-secure-store':secure,'@notifee/react-native':{...notifee,AndroidImportance:{HIGH:4,NONE:0}},'../web/lib/android-sound-policy':loadPolicy()};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/ConnectNativeSoundSettings.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{exports,require:n=>deps[n],Promise,Error});
 return{api:exports,policy:deps['../web/lib/android-sound-policy'],records,played,channels,created,existing,state,native,stops:()=>stops,setRead:fn=>{read=fn;},setVibration:v=>vibration=v};
}
const prefsKey='connect-native-notifications-v1';
const legacyId='connect-native-messages-connect_soft-v5-audible-vib';
const factoryId='connect-native-messages-connect_notification-v6-audible-vib';
test('new call and message previews match the exact bundled MP3 resource names',async()=>{
 const h=fixture();await h.api.previewConnectSound('calls');await h.api.previewConnectSound('messages');
 assert.deepEqual(h.played,['android.resource://com.connect.messenger/raw/connect_ringtone','android.resource://com.connect.messenger/raw/connect_notification']);
 assert.equal(h.stops(),2);
});
test('message vibration preference cannot turn off default call vibration',async()=>{
 const h=fixture();h.records.set(prefsKey,JSON.stringify({vibrate:false}));await h.api.getConnectSoundChannel('calls');assert.equal(h.channels[0][2],true);
 h.setVibration(false);await h.api.getConnectSoundChannel('calls');assert.equal(h.channels[1][2],false);
});
test('custom MediaStore selection and explicit silence survive reload and ringtone reset',async()=>{
 const h=fixture();await h.api.chooseConnectSound('calls');assert.equal((await h.api.getConnectSoundPreference('calls')).name,'Моя мелодия.m4a');
 await h.api.previewConnectSound('calls');assert.equal(h.played.at(-1),'content://media/external/audio/media/17');
 await h.api.setConnectSoundSilence('calls',true);await h.api.resetConnectSound('calls');assert.equal(await h.api.getConnectSoundSilence('calls'),true);assert.equal(await h.api.getConnectSoundPreference('calls'),null);
 const before=h.played.length;await h.api.previewConnectSound('calls');assert.equal(h.played.length,before);
 await h.api.setConnectSoundSilence('calls',false);await h.api.previewConnectSound('calls');assert.equal(h.played.at(-1),'android.resource://com.connect.messenger/raw/connect_ringtone');
});
test('fresh and migrated soft use one stable v6 resource channel; repeats cannot create channels',async()=>{
 const h=fixture();h.records.set(prefsKey,JSON.stringify({enabled:true,vibrate:true,sound:'soft'}));
 const ids=await Promise.all([h.api.getConnectSoundChannel('messages'),h.api.getConnectSoundChannel('messages')]);
 assert.deepEqual(ids,[factoryId,factoryId]);assert.equal(h.created.length,1);assert.equal(h.created[0].sound,'connect_notification');
 await h.api.getConnectSoundChannel('messages');assert.equal(h.created.length,1);
});
test('upgrade inherits channel block, DND, visibility and vibration restrictions without altering v5',async()=>{
 const h=fixture(),old={id:legacyId,name:'Old',blocked:true,importance:0,badge:false,bypassDnd:false,visibility:-1,vibration:false,lights:false,sound:'connect_soft'};
 h.existing.set(legacyId,old);await h.api.getConnectSoundChannel('messages');const c=h.created[0];
 assert.equal(c.importance,0);assert.equal(c.badge,false);assert.equal(c.bypassDnd,false);assert.equal(c.visibility,-1);assert.equal(c.vibration,false);assert.equal(c.sound,'connect_notification');assert.equal(h.existing.get(legacyId),old);
});
test('system-edited mute and custom channel sound are preserved by migration',async()=>{
 for(const [soundURI,expected] of [[undefined,undefined],['content://media/external/audio/media/99','content://media/external/audio/media/99']]){
  const h=fixture();h.existing.set(legacyId,{id:legacyId,name:'Edited',soundURI,importance:2});
  h.native.migratedMessageSound=async()=>soundURI||'';
  await h.api.getConnectSoundChannel('messages');assert.equal(h.created[0].sound,expected);assert.equal(h.created[0].importance,2);
 }
});
test('an already-created v6 channel is never reset after a user changes it',async()=>{
 const h=fixture();h.existing.set(factoryId,{id:factoryId,name:'User',importance:1,soundURI:'custom'});await h.api.getConnectSoundChannel('messages');assert.equal(h.created.length,0);
});
test('bright/gentle/old-soft manually chosen keep old v5 channels and correct previews',async()=>{
 for(const [tone,resource] of [['bright','connect_bright'],['gentle','connect_gentle'],['legacy-soft','connect_soft']]){
  const h=fixture();h.records.set(prefsKey,JSON.stringify({enabled:true,vibrate:false,sound:tone}));
  assert.equal(await h.api.getConnectSoundChannel('messages'),`connect-native-messages-${resource}-v5-audible-still`);
  assert.equal(h.created[0].sound,resource);await h.api.previewConnectSound('messages');assert.equal(h.played[0],'android.resource://com.connect.messenger/raw/'+resource);
 }
});
test('custom message URI always wins over built-in default and retains its v5 channel identity',async()=>{
 const h=fixture();await h.api.chooseConnectSound('messages');const id=h.created[0].id;
 assert.match(id,/connect-native-messages-chosen-[a-f0-9]+-v5-audible-vib/);assert.equal(h.created[0].sound,'content://media/external/audio/media/17');
 await h.api.previewConnectSound('messages');assert.equal(h.played[0],'content://media/external/audio/media/17');
 await h.api.getConnectSoundChannel('messages');assert.equal(h.created.length,1);
});
test('message silence stays silent during upgrade; no system default sound fallback',async()=>{
 const h=fixture();h.records.set(prefsKey,JSON.stringify({enabled:false,vibrate:false,sound:'silent'}));
 assert.match(await h.api.getConnectSoundChannel('messages'),/-v6-silent-still$/);assert.equal(h.created[0].sound,undefined);assert.equal(h.created[0].vibration,false);
 await h.api.previewConnectSound('messages');assert.equal(h.played.length,0);
});
test('reset returns messages to the new default while preserving other preferences and silence',async()=>{
 const h=fixture();h.records.set(prefsKey,JSON.stringify({enabled:false,vibrate:false,sound:'bright'}));await h.api.chooseConnectSound('messages');
 await h.api.setConnectSoundSilence('messages',true);await h.api.resetConnectSound('messages');
 assert.deepEqual(JSON.parse(h.records.get(prefsKey)),{enabled:false,vibrate:false,sound:'soft'});assert.equal(await h.api.getConnectSoundSilence('messages'),true);
 await h.api.setConnectSoundSilence('messages',false);await h.api.previewConnectSound('messages');assert.equal(h.played.at(-1),'android.resource://com.connect.messenger/raw/connect_notification');
});
test('stopping or backgrounding during asynchronous preference reads cannot start a late preview',async()=>{
 for(const background of [false,true]){
  const h=fixture();let resume,reading;const started=new Promise(r=>reading=r);
  h.setRead(k=>k==='connect-native-msg-sound-v2'?new Promise(r=>{resume=r;reading();}):Promise.resolve(null));
  const preview=h.api.previewConnectSound('messages');await started;
  if(background)h.state.currentState='background';else await h.api.stopSoundPreview();resume(null);await preview;assert.equal(h.played.length,0);
 }
});
test('new preview supersedes a slow old request and silent selection stops playback',async()=>{
 const h=fixture();let resume,reading;const started=new Promise(r=>reading=r);
 h.setRead(k=>k==='connect-native-msg-sound-v2'?new Promise(r=>{resume=r;reading();}):Promise.resolve(null));
 const old=h.api.previewConnectSound('messages');await started;await h.api.previewBuiltinSound('bright');resume(null);await old;
 assert.deepEqual(h.played,['android.resource://com.connect.messenger/raw/connect_bright']);
 const stops=h.stops();await h.api.previewBuiltinSound('silent');assert.equal(h.stops(),stops+1);assert.equal(h.played.length,1);
});
test('Android-only legacy-soft never expands the server enum and survives soft remote hydration',()=>{
 const p=loadPolicy(),local={enabled:true,vibrate:true,sound:'legacy-soft'};
 assert.equal(p.serverNotificationPrefs(local).sound,'soft');assert.equal(p.mergeServerNotificationPrefs({...local,sound:'soft'},local).sound,'legacy-soft');
 for(const sound of ['bright','gentle','silent'])assert.equal(p.mergeServerNotificationPrefs({...local,sound},local).sound,sound);
 assert.equal(p.isNotificationTone('file:///secret'),false);
});
test('prebuild verifies exact original bytes and retains all six offline resources',()=>{
 const os=require('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'connect-sounds-'));
 const plugin=require('../plugins/withConnectBuiltinSounds');
 try{plugin.copySounds(path.join(__dirname,'..'),root);const files=fs.readdirSync(path.join(root,'app/src/main/res/raw'));assert.equal(files.length,6);assert.ok(files.includes('connect_ringtone.mp3'));assert.ok(files.includes('connect_notification.mp3'));const stable=fs.readFileSync(path.join(root,'app/connect-sound-ids.txt'),'utf8');assert.match(stable,/raw\/connect_soft = 0x7f110003/);assert.match(stable,/raw\/connect_gentle = 0x7f110002/);const configured=plugin.configureBuild('android { androidResources { } }');assert.match(configured,/--stable-ids/);assert.equal(plugin.configureBuild(configured),configured);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
