const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const message='33333333-3333-4333-8333-333333333333';
const message2='44444444-4444-4444-8444-444444444444';
function harness(entries={},options={}){
  const values=new Map(Object.entries(entries)),reads=[],queries=[];
  const secure={getItemAsync:async key=>{reads.push(key);return values.get(key)??null;},
    setItemAsync:()=>{throw Error('migration must not write native storage');},deleteItemAsync:()=>{throw Error('migration must not delete native storage');}};
  const db={auth:{getSession:async()=>({data:{session:{user:{id:options.user||owner}}}})},from:table=>{
    assert.equal(table,'conversations');
    const query={select:columns=>{assert.equal(columns,'id');return query;},or:filter=>{assert.equal(filter,'user_a.eq.'+owner+',user_b.eq.'+owner);return query;},
      order:()=>query,range:async(start,end)=>{queries.push([start,end]);return options.error?{data:null,error:{message:'offline'}}:{data:(options.conversations||[]).slice(start,end+1),error:null};}};
    return query;
  }};
  const filesystem={documentDirectory:'file:///private/documents/',EncodingType:{Base64:'base64'},getInfoAsync:async()=>({exists:true,isDirectory:false,size:10}),readAsStringAsync:async()=> 'iVBORw0KGgo='};
  const modules={'expo-secure-store':secure,'expo-file-system/legacy':filesystem,'./backend':{db}};
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/hybridMigration.ts'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText,{exports,require:name=>modules[name],Date,Set,Map,Object,Number,JSON,Promise,Error});
  return {migrate:exports.legacyWebStorage,reads,queries,values};
}
test('native settings map to actual PWA keys without rewriting native storage or read receipts',async()=>{
  const entries={
    'connect-native-pwa-appearance-v2':JSON.stringify({scene:'glow',mode:'light',accent:'#aabbcc',enabledPacks:['blocks','blocks','bad'],wallpaper:'file:///private/documents/connect-native-chat-wallpaper.jpg'}),
    ['connect-native-sticker-favorites-v1.'+owner]:JSON.stringify(['speed:hello','invalid:x','speed:hello']),
    ['connect-native-sticker-recent-v1.'+owner]:JSON.stringify(['blocks:party']),
    ['connect-native-cleared-chats.'+owner]:JSON.stringify({[other]:'2026-01-01T00:00:00Z',bad:'invalid'}),
    'connect-native-notifications-v1':JSON.stringify({enabled:false,vibrate:false,sound:'gentle'}),
    ['connect-native-last-viewed-calls-'+owner]:'123456',
    'connect-native-music-playback-v1':JSON.stringify({ownerId:other,path:other+'/song.mp3',position:32.5,shuffle:true,repeat:false,muted:true}),
    'connect-native-music-mini-bottom-v1':'140','connect-sonic-runner-best-v1':'99',
    ['connect-native-read-marker-v1-'+other]:'2026-03-01T00:00:00Z',
    ['connect-native-chat-hidden-v1.'+owner+'.'+other]:JSON.stringify([message,message,'bad']),
  };
  const h=harness(entries,{conversations:[{id:other}]});
  const mapped=await h.migrate(owner);
  assert.equal(mapped['connect-theme'],'light');assert.equal(mapped['connect-visual-scene'],'aurora');assert.equal(mapped['connect-accent'],'#aabbcc');
  assert.deepEqual(JSON.parse(mapped['connect-sticker-packs']),['blocks']);
  assert.deepEqual(JSON.parse(mapped['connect-sticker-favorites']),['speed:hello']);
  assert.deepEqual(JSON.parse(mapped['connect-sticker-recent']),['blocks:party']);
  assert.deepEqual(JSON.parse(mapped['connect-hidden-messages:'+owner]),[message]);
  assert.deepEqual(JSON.parse(mapped['connect-cleared-chats:'+owner]),{[other]:'2026-01-01T00:00:00Z'});
  assert.equal(mapped['connect-last-viewed-calls:'+owner],'123456');
  assert.equal(JSON.parse(mapped['connect-profile-music-playback-v1']).position,32.5);
  assert.equal(mapped['connect-android-legacy-wallpaper'],'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(h.reads.some(key=>key.includes('read-marker')),false);
  assert.deepEqual(Object.fromEntries(h.values),entries);
});
test('hidden-message migration pages all RLS conversations and unions owner-scoped keys',async()=>{
  const conversations=Array.from({length:501},(_,i)=>({id:i.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111'}));
  const h=harness({
    ['connect-native-chat-hidden-v1.'+owner+'.'+conversations[0].id]:JSON.stringify([message]),
    ['connect-native-chat-hidden-v1.'+owner+'.'+conversations[500].id]:JSON.stringify([message2]),
    ['connect-native-chat-hidden-v1.'+other+'.'+conversations[0].id]:JSON.stringify([other]),
  },{conversations});
  const mapped=await h.migrate(owner);
  assert.deepEqual(JSON.parse(mapped['connect-hidden-messages:'+owner]),[message,message2]);
  assert.deepEqual(h.queries,[[0,499],[500,999]]);
  assert.equal(h.reads.some(key=>key.startsWith('connect-native-chat-hidden-v1.'+other+'.')),false);
});
test('account mismatch exports nothing; offline pagination cannot falsely complete local-delete migration',async()=>{
  const wrong=harness({}, {user:other});assert.equal(Object.keys(await wrong.migrate(owner)).length,0);assert.equal(wrong.reads.length,0);
  const offline=harness({}, {error:true});await assert.rejects(()=>offline.migrate(owner),/локальное скрытие/);
});
test('malformed values and untrusted wallpaper paths do not enter the WebView',async()=>{
  const h=harness({'connect-native-pwa-appearance-v2':JSON.stringify({mode:'bad',scene:'bad',accent:'url(evil)',wallpaper:'file:///private/documents/auth.db'}),
    ['connect-native-sticker-favorites-v1.'+owner]:'not json','connect-native-music-playback-v1':'{}'});
  assert.equal(Object.keys(await h.migrate(owner)).length,0);
});
