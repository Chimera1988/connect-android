'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../web/app/page.tsx'),'utf8');
function makeLogout(result){
  const begin=source.indexOf('  async function logout() {');
  const end=source.indexOf('\n  const keyboardOpen',begin);
  assert(begin>=0&&end>begin,'Logout body missing or moved');
  const events=[];
  const verifiedSessionRef={current:true};
  const deps={
    window:{__connectPrepareSession:async()=>{}},
    supabase:{auth:{signOut:async opts=>{events.push(['signOut',opts]);return result;}}},
    authSequence:{current:0},
    verifiedSessionRef,
    setConnectionStatus:()=>{},
    CONNECT_LOCAL_LOGOUT_FLAG:'connect-local-logout-v1',
    localStorage:{setItem:(k,v)=>events.push(['storage',k,v])},
    user:{id:'00000000-0000-0000-0000-000000000001'},
    setAuthGate:v=>events.push(['gate',v]),setUser:v=>events.push(['user',v]),
    setLoading:v=>events.push(['loading',v]),setSetup:v=>events.push(['setup',v]),
    setBusy:v=>events.push(['busy',v]),setNotice:v=>events.push(['notice',v]),
    exitChat:()=>events.push(['exitChat']),setProfiles:()=>{},setConversations:()=>{},setMessages:()=>{},
    setLatest:()=>{},setUnread:()=>{},readCache:{current:{}},setPassword:()=>{},
    historyWarmStamps:{current:{}},inboxMediaWarm:{current:{clear(){}}},
    avatarCacheEpoch:{current:0},setAvatarUrls:()=>{},forgetUserChatPresentation:()=>{},
    warmedChatWindows:{current:{clear(){}}},signedMediaLifetimes:{current:{clear(){}}},
    clearStoredConnectAuth:()=>events.push(['purgeTokens']),
    wipeUserHistory:async()=>events.push(['wipe']),
  };
  const body=ts.transpileModule(source.slice(begin,end)+'\nreturn logout;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const logout=Function(...Object.keys(deps),body)(...Object.values(deps));
  return {events,logout,verifiedSessionRef};
}
test('sign-out immediately locks the UI before the asynchronous network request',async()=>{
  const {events,logout,verifiedSessionRef}=makeLogout({error:null});
  const attempt=logout();
  assert.equal(verifiedSessionRef.current,false,'verified session must be revoked on logout');
  assert(events.some(e=>e[0]==='gate'&&e[1]==='denied'));
  assert(events.some(e=>e[0]==='user'&&e[1]===null));
  assert(events.some(e=>e[0]==='storage'&&e[2]==='1'));
  await attempt;
  assert.deepEqual(events.find(e=>e[0]==='signOut')[1],{scope:'local'});
  assert(events.some(e=>e[0]==='purgeTokens'));
  assert(events.some(e=>e[0]==='wipe'));
});
test('missing Supabase auth session is treated as successful local exit',async()=>{
  const error=new Error('Auth session missing!');error.name='AuthSessionMissingError';
  const {events,logout}=makeLogout({error});
  await logout();
  assert(events.some(e=>e[0]==='gate'&&e[1]==='denied'));
  assert(events.some(e=>e[0]==='purgeTokens'));
  assert(events.some(e=>e[0]==='wipe'));
  assert(!events.some(e=>e[0]==='notice'&&String(e[1]).includes('Не удалось выйти')));
});
test('network sign-out failure still closes the screen and removes local credentials',async()=>{
  const {events,logout}=makeLogout({error:new Error('network unavailable')});
  await logout();
  assert(events.some(e=>e[0]==='user'&&e[1]===null));
  assert(events.some(e=>e[0]==='purgeTokens'));
  assert(events.some(e=>e[0]==='wipe'));
  assert(events.some(e=>e[0]==='notice'&&String(e[1]).includes('Серверный выход не подтверждён')));
});
test('SIGNED_OUT auth event locks the UI before the native session bridge',()=>{
  const start=source.indexOf('supabase.auth.onAuthStateChange((event,session)=>');
  const end=source.indexOf('window.addEventListener(\'offline\',onOffline)',start);
  assert(start>=0&&end>start,'Session listener not found');
  const body=source.slice(start,end);
  assert.match(body,/event==='SIGNED_OUT'/);
  assert.match(body,/denyPrivateAccess\(\)/);
  assert.match(source,/const denyPrivateAccess = useCallback\(\(\) => \{\s*verifiedSessionRef\.current = false;\s*setConnectionStatus\('online'\);\s*setUser\(null\)/);
});
