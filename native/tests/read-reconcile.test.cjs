const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const chat='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const at=n=>`2026-11-15T10:00:${n}.000Z`,tick=()=>new Promise(r=>setImmediate(r));
function harness(){
 const effects=[],callbacks={},dismissed=[],markers=[],intervals=[];
 const state={currentState:'active',addEventListener:(_,fn)=>{callbacks.resume=fn;return {remove(){}};}};
 const data={alerts:[{notification:{data:{kind:'message',conversationId:chat,createdAt:at(10)}}},{notification:{data:{kind:'message',conversationId:second,createdAt:at(30)}}}],reads:[{conversation_id:chat,last_read_at:at(20)},{conversation_id:second,last_read_at:at(20)}],error:null};
 const db={from:()=>({select:()=>({eq:()=>({in:async()=>({data:data.reads,error:data.error})})})}),channel:()=>{const c={on:(_,__,fn)=>{callbacks.read=fn;return c;},subscribe:()=>c};return c;},removeChannel:async()=>{}};
 const deps={react:{useEffect:fn=>effects.push(fn)},'react-native':{AppState:state},'@notifee/react-native':{default:{getDisplayedNotifications:async()=>data.alerts},__esModule:true},'./backend':{db},'./ConnectNativePush':{rememberReadAt:async(...v)=>markers.push(v),dismissChatPush:async(...v)=>dismissed.push(v)}};
 const order={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('web/lib/chat-order.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:order});deps['../web/lib/chat-order']=order;
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/ConnectNativeReadSync.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:n=>deps[n],setInterval:fn=>intervals.push(fn),clearInterval(){},console});
 exports.useConnectNativeReadSync('owner');const clean=effects.map(fn=>fn());
 return {data,state,dismissed,markers,callbacks,dispose:()=>clean.forEach(fn=>fn?.())};
}
test('launch reconciliation clears only server-confirmed read chat',async()=>{const h=harness();await tick();assert.deepEqual(h.dismissed,[[chat,at(20)]]);h.dispose();});
test('resume and remote reads reconcile, errors never imply everything was read',async()=>{const h=harness();await tick();h.dismissed.length=0;h.data.error=Error('offline');h.callbacks.read();await tick();assert.equal(h.dismissed.length,0);h.data.error=null;h.data.reads[1].last_read_at=at(40);h.callbacks.resume('active');await tick();assert.equal(h.dismissed.length,2);h.dispose();});
test('background/unmount cannot remove notifications from a stale session',async()=>{const h=harness();h.dispose();await tick();assert.equal(h.dismissed.length,0);});
test('hybrid app mounts cross-device read reconciliation for authenticated owner',()=>{assert.match(fs.readFileSync('src/App.tsx','utf8'),/useConnectNativeReadSync\(ownerId\)/);});
test('a failed or evicted WebView cannot keep suppressing alerts for its former chat',()=>{
 const source=fs.readFileSync('src/App.tsx','utf8');
 for(const name of ['onError','onRenderProcessGone']){
  const body=source.match(new RegExp(name+'=\\{\\(\\)=>\\{([^}]+)\\}\\}'))?.[1];assert(body,'missing '+name+' callback');
  const active={current:chat},loaded={current:true};let visible=chat;
  new Function('active','loaded','setVisibleConversation','abortTransfers','setFailure',body)(active,loaded,id=>visible=id,()=>{},()=>{});
  assert.equal(visible,null,name);assert.equal(active.current,'',name);assert.equal(loaded.current,false,name);
 }
});
