'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../web/app/page.tsx'),'utf8');
const begin=source.indexOf('  const verifyAuth = useCallback(async () => {');
const end=source.indexOf('\n\n  useEffect(() => {\n    if(!supabase)',begin);
assert(begin>=0&&end>begin,'SOURCE_DRIFT: auth function moved');
const compiled=ts.transpileModule(source.slice(begin,end)+'\nreturn verifyAuth;',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}});

function scenario({verified=false,status=200,networkFailure=false,sessionMissing=false,serverMismatch=false,online=true}={}) {
  const events=[];
  const verifiedSessionRef={current:verified};
  const session={access_token:'safe-unit-test-token',user:{id:'demo-user'}};
  const deps={
    useCallback:fn=>fn,
    supabase:{auth:{getSession:async()=>({data:{session:sessionMissing?null:session},error:null})}},
    verifiedSessionRef,
    authSequence:{current:0},
    locallyLoggedOut:()=>false,
    loginInProgress:{current:false},
    clearStoredConnectAuth:()=>events.push(['purge']),
    denyPrivateAccess:()=>{verifiedSessionRef.current=false;events.push(['deny'])},
    setAuthGate:v=>events.push(['gate',v]),
    setLoading:v=>events.push(['loading',v]),
    setUser:v=>events.push(['user',v]),
    setConnectionStatus:v=>events.push(['status',v]),
    navigator:{onLine:online},
    setSetup:v=>events.push(['setup',v]),
    invited:false,
    passwordRecoveryPending:{current:false},
    window:{__connectPrepareSession:async()=>{}},
    fetch:async()=>{
      if(networkFailure)throw new TypeError('Failed to fetch');
      return {status,ok:status>=200&&status<300,json:async()=>({ok:!serverMismatch,userId:serverMismatch?'somebody-else':session.user.id})};
    },
  };
  const verifyAuth=Function(...Object.keys(deps),compiled.outputText)(...Object.values(deps));
  return {events,verifiedSessionRef,verifyAuth};
}
const has=(h,k,v)=>h.events.some(([key,value])=>key===k&&(argumentsUnused(v)||value===v));
function argumentsUnused(value){return value===undefined;}

test('a periodic recheck keeps the verified chat visible and mounted',async()=>{
  const h=scenario({verified:true});
  await h.verifyAuth();
  assert.equal(has(h,'gate','checking'),false);
  assert.equal(has(h,'loading',true),false);
  assert.equal(has(h,'gate','offline'),false);
  assert.equal(h.verifiedSessionRef.current,true);
  assert.equal(has(h,'status','online'),true);
});

test('cold boot remains closed until successful live server verification',async()=>{
  const h=scenario();
  const pending=h.verifyAuth();
  assert.equal(has(h,'gate','checking'),true);
  assert.equal(has(h,'loading',true),true);
  await pending;
  assert.equal(h.verifiedSessionRef.current,true);
  assert.equal(has(h,'gate','verified'),true);
});

test('a temporary network failure preserves already verified chat in memory',async()=>{
  const h=scenario({verified:true,networkFailure:true});
  await h.verifyAuth();
  assert.equal(h.verifiedSessionRef.current,true);
  assert.equal(has(h,'gate','checking'),false);
  assert.equal(has(h,'gate','offline'),false);
  assert.equal(has(h,'user',null),false);
  assert.equal(has(h,'status','reconnecting'),true);
});

test('HTTP 503 is transient for an existing verified session',async()=>{
  const h=scenario({verified:true,status:503});
  await h.verifyAuth();
  assert.equal(h.verifiedSessionRef.current,true);
  assert.equal(has(h,'gate','offline'),false);
  assert.equal(has(h,'status','reconnecting'),true);
});

test('cold boot with no network does not expose private data',async()=>{
  const h=scenario({online:false});
  await h.verifyAuth();
  assert.equal(has(h,'gate','offline'),true);
  assert.equal(has(h,'user',null),true);
  assert.equal(h.verifiedSessionRef.current,false);
});

test('already verified session going offline preserves chat and reports status',async()=>{
  const h=scenario({verified:true,online:false});
  await h.verifyAuth();
  assert.equal(has(h,'gate','offline'),false);
  assert.equal(has(h,'user',null),false);
  assert.equal(has(h,'status','offline'),true);
});

test('confirmed 401 and 403 revoke authorization immediately',async()=>{
  for(const status of [401,403]){
    const h=scenario({verified:true,status});
    await h.verifyAuth();
    assert.equal(has(h,'purge'),true);
    assert.equal(has(h,'deny'),true);
    assert.equal(h.verifiedSessionRef.current,false);
  }
});

test('confirmed missing session and server identity mismatch remain fail closed',async()=>{
  for(const opts of [{sessionMissing:true},{serverMismatch:true}]){
    const h=scenario({verified:true,...opts});
    await h.verifyAuth();
    assert.equal(has(h,'purge'),true);
    assert.equal(has(h,'deny'),true);
  }
});

test('network, logout and signed-out handlers preserve correct security boundaries',()=>{
  assert.match(source,/const onOffline=\(\)=>\{\s*\+\+authSequence\.current;\s*if\(verifiedSessionRef\.current\)/);
  assert.match(source,/const denyPrivateAccess = useCallback\(\(\) => \{\s*verifiedSessionRef\.current = false;/);
  assert.match(source,/async function logout\(\) \{[\s\S]*?\+\+authSequence\.current;\s*verifiedSessionRef\.current = false;/);
  assert.match(source,/event==='SIGNED_OUT'\|\|!session/);
  assert.match(source,/connectionStatus!=='online'/);
  assert.match(source,/const timer=window\.setInterval\(onReturn,60000\)/);
});
