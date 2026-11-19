const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('native logout blocks outgoing messages and removes both stored session copies before network cleanup',async()=>{
 const source=fs.readFileSync('src/backend.ts','utf8');
 const events=[],store=new Map();let net=0;
 const nativeAuth={getAuth:async key=>store.get(key)??null,setAuth:async(k,v)=>store.set(k,v),removeAuth:async k=>{events.push('native-remove');store.delete(k);}};
 const secure={getItemAsync:async k=>store.get(k)??null,setItemAsync:async(k,v)=>{store.set(k,v);},deleteItemAsync:async k=>{events.push('secure-remove');store.delete(k);}};
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const exports={};let options;
 Function('require','exports','fetch','process',js)(name=>name==='react-native'?{NativeModules:{ConnectCallCoordinator:nativeAuth}}:name==='expo-secure-store'?secure:name==='@supabase/supabase-js'?{createClient:(_url,_key,o)=>{options=o;return {};}}:{},exports,async()=>{net++;return {};},{env:{}});
 assert.equal(typeof exports.lockNativeSession,'function');
 await options.auth.storage.setItem('sb-tpwkmoxxzjfdsqsomhhr-auth-token','old');
 const lock=exports.lockNativeSession(async()=>{events.push('wipe');});
 await assert.rejects(()=>options.global.fetch('https://tpwkmoxxzjfdsqsomhhr.supabase.co/rest/v1/messages'),/SESSION_LOCKED/);
 await lock;await assert.rejects(()=>options.auth.storage.setItem('sb-tpwkmoxxzjfdsqsomhhr-auth-token','late-refresh'),/SESSION_LOCKED/);assert.equal(net,0);assert(events.includes('native-remove'));assert(events.includes('secure-remove'));assert(events.includes('wipe'));assert(events.indexOf('wipe')<events.indexOf('native-remove'));
 assert.equal(await options.auth.storage.getItem('sb-tpwkmoxxzjfdsqsomhhr-auth-token'),null);
 await exports.unlockNativeSession();await options.global.fetch('https://tpwkmoxxzjfdsqsomhhr.supabase.co/rest/v1/messages');assert.equal(net,1);
});
