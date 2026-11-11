const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const id='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222',chat='33333333-3333-4333-8333-333333333333';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
function harness(permission){
 let si=0,ri=0,requests=0;const states=[],refs=[],effects=[],dials=[],controls=[],callbacks=new Map();
 const native={getState:async()=>({phase:'idle',state:'IDLE',sequence:0}),dial:async(...args)=>dials.push(args),control:async(...args)=>controls.push(args),chooseRoute:async()=>{}};
 const react={useState(v){const i=si++;if(!(i in states))states[i]=v;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=ri++;return refs[i]||=( {current:v})},useEffect:f=>effects.push(f),useCallback:f=>f,createElement(){}};
 const policy={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/call-missed.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{exports:policy,require:()=>require('../shared/call-missed-policy.json'),Date,Number});
 const mocks={'./call-missed':policy,react,'react-native':{NativeModules:{ConnectCallCoordinator:native,ConnectIncomingCallModule:{requestMicrophone:async()=>{requests++;return permission?permission.promise:true}}},AppState:{addEventListener:()=>({remove(){}})},DeviceEventEmitter:{addListener:(n,fn)=>{callbacks.set(n,fn);return{remove:()=>callbacks.delete(n)}}}},'expo-crypto':{randomUUID:()=>id},'@expo/vector-icons/Ionicons':{},'react-native-svg':{},'./ConnectNativeGlass':{}};
 const compiled=ts.transpileModule(fs.readFileSync(require.resolve('../src/ConnectNativeVoice.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,exports={};
 vm.runInNewContext(compiled,{exports,require:n=>{if(!(n in mocks))throw Error('Unexpected dependency '+n);return mocks[n]},setInterval:()=>1,clearInterval(){},console,Promise,Date});
 return{native,policy,render(){si=ri=0;return exports.useConnectNativeVoice(id,[])},dials,controls,states,callbacks,get requests(){return requests},mount(){return effects.map(f=>f()).filter(Boolean)}};
}
test('two taps during microphone permission delegate one outgoing operation',async()=>{const p=deferred(),h=harness(p),v=h.render(),first=v.dial(chat,peer,'Peer'),second=v.dial(chat,peer,'Peer');assert.equal(h.requests,1);p.resolve(true);await Promise.all([first,second]);assert.equal(h.dials.length,1);assert.deepEqual(h.dials[0],[chat,peer,'Peer',id])});
test('cancel before a late permission grant never delegates capture/dial',async()=>{const p=deferred(),h=harness(p),v=h.render(),dial=v.dial(chat,peer,'Peer');await v.finish();p.resolve(true);await dial;assert.equal(h.dials.length,0);assert.deepEqual(h.controls,[[id,'end']])});
test('denied permission reports an error and creates no call',async()=>{const p=deferred(),h=harness(p),v=h.render(),dial=v.dial(chat,peer,'Peer');p.resolve(false);await assert.rejects(dial);assert.equal(h.dials.length,0);assert.match(h.states[1],/микрофону/) });
test('answer forwards the exact expected UUID for native ownership validation',async()=>{const h=harness(),v=h.render();await v.accept(peer);assert.deepEqual(h.controls,[[peer,'answer']])});
test('unmounting React removes listeners without hanging up a native call',async()=>{const h=harness();h.render();const clean=h.mount();for(const fn of clean)fn();await Promise.resolve();assert.equal(h.callbacks.size,0);assert.equal(h.controls.length,0)});
test('late older snapshots cannot replace a newer native call state',async()=>{const h=harness();h.render();h.mount();const emit=h.callbacks.get('connect:call-state');emit({phase:'active',state:'ACTIVE',sequence:5,userId:id,callId:peer});emit({phase:'incoming',state:'INCOMING',sequence:4,userId:id,callId:chat});assert.equal(h.states[0].phase,'active');assert.equal(h.states[0].callId,peer)});

test('native preparation rejection reaches the bridge and a new attempt is allowed',async()=>{
 const h=harness(),v=h.render();h.native.dial=async()=>{throw Error('Микрофон недоступен')};await assert.rejects(v.dial(chat,peer,'Peer','request-1'),/Микрофон/);
 h.native.dial=async(...args)=>h.dials.push(args);await v.dial(chat,peer,'Peer','request-2');assert.equal(h.dials.length,1);
});
test('late bridge timeout cannot end an already active native call',async()=>{
 const p=deferred(),h=harness(p),v=h.render(),dial=v.dial(chat,peer,'Peer','request-1');
 h.native.getState=async()=>({phase:'active'});await v.cancelPending('request-1');assert.equal(h.controls.length,0);p.resolve(true);await dial;
});

test('accepted native snapshot prevents stale ringing from becoming a missed badge',()=>{
 const h=harness();h.render();h.mount();const emit=h.callbacks.get('connect:call-state');
 emit({phase:'connecting',state:'ANSWERING',sequence:1,userId:id,callId:peer});
 const row={id:peer,callee_id:id,status:'ringing',created_at:'2020-01-01T00:00:00Z'};
 assert.equal(h.policy.isMissedIncomingCall(row,id),false);
 emit({phase:'idle',state:'ENDED',sequence:2,userId:id,callId:peer});assert.equal(h.policy.isMissedIncomingCall(row,id),true);
});
