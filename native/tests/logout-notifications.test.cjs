const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function harness(){
 const text=fs.readFileSync('src/ConnectNativePush.ts','utf8'),start=text.indexOf('export async function disableNativePush('),end=text.indexOf('/** Firebase permits',start);
 assert(start>0&&end>start);const events=[];let release;
 const deps={SecureStore:{setItemAsync:async()=>events.push('disabled')},DEVICE_ACTIVE_KEY:'active',db:{auth:{getSession:async()=>({data:{session:null}})}},
 getMessaging:()=>({}),getToken:()=>{events.push('token');return new Promise(r=>release=r);},notifee:{cancelAllNotifications:async()=>events.push('cancelled')},console,AbortController,setTimeout,clearTimeout,API:'https://connect-chat.duckdns.org',fetch:async()=>({ok:true}),sendRegistration:async()=>{}};
 const exports={};const js=ts.transpileModule(text.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 Function('exports',...Object.keys(deps),js)(exports,...Object.values(deps));return{events,push:exports,release:()=>release?.('test-token')};
}
test('logged-out cold boot cancels local alerts without waiting for Firebase token or network',async()=>{
 const h=harness();const task=h.push.disableNativePush({userId:'',accessToken:''});await new Promise(r=>setImmediate(r));
 h.release();await task;assert(!h.events.includes('token'));assert(h.events.includes('cancelled'));
});
test('logout cancels private alerts before potentially slow remote deregistration',async()=>{
 const h=harness();const task=h.push.disableNativePush({userId:'user',accessToken:'old'});await new Promise(r=>setImmediate(r));
 const cancelled=h.events.includes('cancelled');h.release();await task;assert(cancelled);
});
