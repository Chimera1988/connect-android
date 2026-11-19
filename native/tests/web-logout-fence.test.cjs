const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('logged-out WebView cannot send using a captured bearer token, but can log in again',async()=>{
 assert(fs.existsSync('web/lib/session-network-fence.ts'),'web network fence missing');
 const js=ts.transpileModule(fs.readFileSync('web/lib/session-network-fence.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};Function('exports',js)(exports);let locked=true,sent=0;
 const fetch=exports.fencedSessionFetch(async()=>{sent++;return {};},()=>locked,'https://connect-chat.duckdns.org','https://tpwkmoxxzjfdsqsomhhr.supabase.co');
 await assert.rejects(()=>fetch('/supabase/rest/v1/messages',{method:'POST'}),/SESSION_LOCKED/);
 await assert.rejects(()=>fetch('https://tpwkmoxxzjfdsqsomhhr.supabase.co/rest/v1/messages',{method:'POST'}),/SESSION_LOCKED/);
 await assert.rejects(()=>fetch('/supabase/auth/v1/token?grant_type=refresh_token',{method:'POST'}),/SESSION_LOCKED/);
 await fetch('/supabase/auth/v1/token?grant_type=password',{method:'POST'});
 assert.equal(sent,1);locked=false;await fetch('/supabase/rest/v1/messages',{method:'POST'});assert.equal(sent,2);
});
