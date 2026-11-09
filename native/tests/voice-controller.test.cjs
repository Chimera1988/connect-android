const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const deferred = () => { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const caller = '11111111-1111-4111-8111-111111111111';
const callee = '22222222-2222-4222-8222-222222222222';
const row = {id:'33333333-3333-4333-8333-333333333333',conversation_id:'44444444-4444-4444-8444-444444444444',caller_id:caller,callee_id:callee,status:'ringing',created_at:new Date().toISOString(),answered_at:null,offer:{type:'offer',sdp:'offer'}};

// Load the actual hook with Android/native services stubbed. Effects are excluded
// so these regressions exercise user actions without polling or device hardware.
function harness(options = {}) {
  const states = [], refs = [], peers = [], inserts = [], rpcs = [];
  let si = 0, ri = 0, requests = 0, stopped = 0;
  const track = {enabled:true, stop(){stopped++;}};
  const stream = {getTracks:()=>[track],getAudioTracks:()=>[track]};
  const react = {useState(initial){const index=si++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef(initial){const index=ri++;return refs[index] ||= {current:initial};},useCallback:fn=>fn,useEffect(){},createElement(){}};
  class Peer {
    constructor(){this.handlers={};peers.push(this);this.connectionState='new';}
    addTrack(){} addEventListener(event,fn){this.handlers[event]=fn;}
    async createOffer(){return options.offer?await options.offer.promise:{type:'offer',sdp:'offer'};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){this.remoteDescription=value;}
    async addIceCandidate(){} close(){this.closed=true;}
  }
  let failOnce = !!options.failIce;
  const db = {auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})},rpc:async(name,args)=>{rpcs.push({name,args});return {data:row,error:null};},from(table){
    const query = {select(){return query;},eq(){return query;},order(){return query;},limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:row,error:null}),async insert(value){inserts.push(value);if(failOnce){failOnce=false;return {error:{message:'offline'}};}return {error:null};}};
    return query;
  }};
  const stubs = {'react':react,'react-native':{},'@expo/vector-icons/Ionicons':{},'react-native-svg':{},'./ConnectNativeGlass':{},'react-native-webrtc':{mediaDevices:{getUserMedia:async()=>{requests++;return options.microphone?await options.microphone.promise:stream;}},RTCPeerConnection:Peer,RTCSessionDescription:class {constructor(value){Object.assign(this,value);}},RTCIceCandidate:class {constructor(value){Object.assign(this,value);}}},'react-native-incall-manager':{start(){},stop(){},startRingback(){},stopRingback(){},stopRingtone(){}},'react-native-callkeep':{},'./ConnectNativeTelecom':{endSystemCall:async()=>{},showOutgoingSystemCall:async()=>{},showIncomingSystemCall:async()=>{},answerSystemCall:async()=>{}},'./backend':{db}};
  const source=readFileSync(path.join(__dirname,'../src/ConnectNativeVoice.tsx'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const exports={};
  vm.runInNewContext(compiled,{exports,require:name=>{if(!(name in stubs))throw Error(name);return stubs[name];},console,process:{env:{}},fetch:async()=>options.iceConfig?await options.iceConfig.promise:{ok:true,json:async()=>({iceServers:[]})},setTimeout,clearTimeout,Set,Date,Promise},{filename:'ConnectNativeVoice.js'});
  const render=()=>{si=0;ri=0;return exports.useConnectNativeVoice(options.userId||caller,[]);};
  return {render,peers,inserts,rpcs,stream,get requests(){return requests;},get stopped(){return stopped;}};
}

test('cancelling while Android asks for microphone permission stops the late stream',async()=>{
  const microphone=deferred(), h=harness({microphone}), voice=h.render();
  const dialing=voice.dial(row.conversation_id,callee,'Peer');
  await voice.finish();microphone.resolve(h.stream);await dialing;
  assert.equal(h.stopped,1);assert.equal(h.peers.length,0);assert.equal(h.rpcs.length,0);
});

test('cancelling while TURN configuration loads cannot create a late peer',async()=>{
  const iceConfig=deferred(),h=harness({iceConfig}),voice=h.render();
  const dialing=voice.dial(row.conversation_id,callee,'Peer');await tick();
  await voice.finish();iceConfig.resolve({ok:true,json:async()=>({iceServers:[]})});await dialing;
  assert.ok(h.stopped>=1);assert.equal(h.peers.length,0);assert.equal(h.rpcs.length,0);
});

test('two taps before a React render start only one outgoing call',async()=>{
  const microphone=deferred(),h=harness({microphone}),voice=h.render();
  const first=voice.dial(row.conversation_id,callee,'Peer');
  const second=voice.dial(row.conversation_id,callee,'Peer');
  assert.equal(h.requests,1);microphone.resolve(h.stream);await Promise.all([first,second]);
  assert.equal(h.rpcs.filter(x=>x.name==='connect_start_audio_call').length,1);
});

test('failed ICE insertion retains every candidate and retries in order',async()=>{
  const h=harness({failIce:true}),voice=h.render();await voice.dial(row.conversation_id,callee,'Peer');
  const emit=candidate=>h.peers[0].handlers.icecandidate({candidate:{toJSON:()=>({candidate})}});
  emit('first');emit('second');await tick();emit('third');await tick();
  assert.deepEqual(h.inserts.map(x=>x.candidate.candidate),['first','first','second','third']);
});

test('a delayed system answer action cannot accept another incoming call',async()=>{
  const h=harness({userId:callee}),voice=h.render();await voice.checkIncoming(row.id);
  await voice.accept('55555555-5555-4555-8555-555555555555');
  assert.equal(h.requests,0);assert.equal(h.rpcs.length,0);
});
