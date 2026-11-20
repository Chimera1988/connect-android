'use strict';
// CONNECT_ANDROID_INCOMING_VOICE_WAVE_CACHE_V1_20261116
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const SOURCE = fs.readFileSync(path.join(__dirname,'../web/lib/chat-media-presentation.ts'),'utf8');
const PAGE = fs.readFileSync(path.join(__dirname,'../web/app/page.tsx'),'utf8');
const compiled = ts.transpileModule(SOURCE,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.deepEqual(compiled.diagnostics||[],[]);
const UUID='fa89798d-a50e-4b43-a49e-a6880520f308';
function harness(){
 const ls=new Map(); const events=[]; const request=[]; const samples=new Float32Array(430);
 for(let i=0;i<samples.length;i++)samples[i]=Math.sin(i*.4)*(.2+.7*(i%38)/38);
 class AudioContextFake{async decodeAudioData(bytes){assert(bytes.byteLength>0);return {duration:4,getChannelData:()=>samples};}async close(){}}
 let network=0,local=0;
 const context={exports:{},Map,Set,Array,Number,Math,Date,JSON,Promise,AbortController,Error,ArrayBuffer,
  setTimeout,clearTimeout,AudioContext:AudioContextFake,
  window:{ConnectNative:{},dispatchEvent(e){events.push(e)}},CustomEvent:class{constructor(type,payload){this.type=type;this.detail=payload.detail}},
  localStorage:{getItem:k=>ls.get(k)||null,setItem:(k,v)=>ls.set(k,v)},
  fetch:async src=>{request.push(src);if(String(src).startsWith('blob:'))local++;else network++;return {ok:true,headers:{get:()=>String(2048)},arrayBuffer:async()=>new ArrayBuffer(2048)}}};
 vm.runInNewContext(compiled.outputText,context,{filename:'chat-media-presentation.js'});
 return {api:context.exports,request,events,get network(){return network},get local(){return local},ls};
}

test('visible Android voice derives 43 non-flat bars from its existing local blob',async()=>{
 const h=harness(),file=UUID+'/incoming.m4a';let resolver=0;
 await h.api.prewarmChatWave(UUID,file,'https://signed.example/audio',32*1024,async()=>{resolver++;return 'blob:cached-voice'});
 assert.equal(resolver,1,'the native cached-source resolver must run');
 assert.equal(h.network,0,'decoding must not download the signed URL');
 assert.equal(h.local,1,'one cached blob should be read');
 const saved=h.api.readChatWave(UUID,file);
 assert.equal(saved.bars.length,43);assert(saved.duration>0);
 assert(new Set(saved.bars.map(n=>n.toFixed(2))).size>5,'the waveform must contain real peaks, not uniform placeholders');
 assert(h.events.some(e=>e.type==='connect:chat-wave'&&e.detail.path===file));
});

test('duplicate visible render and remount do not re-read cached voice',async()=>{
 const h=harness(),p=UUID+'/same.m4a';let resolver=0;
 await Promise.all(Array.from({length:6},()=>h.api.prewarmChatWave(UUID,p,'https://signed.example/one',20480,async()=>{resolver++;return 'blob:one'})));
 assert.equal(h.local,1);assert.equal(resolver,1);
 await h.api.prewarmChatWave(UUID,p,'https://signed.example/two',20480,async()=>{resolver++;return 'blob:one'});
 assert.equal(h.local,1);assert.equal(resolver,1);
});

test('Android refuses network waveform fetches when local bytes are absent',async()=>{
 const h=harness(),p=UUID+'/missing.m4a';
 await h.api.prewarmChatWave(UUID,p,'https://signed.example/missing',20480,async()=>null);
 assert.equal(h.network,0);assert.equal(h.local,0);assert.equal(h.api.readChatWave(UUID,p),null);
 await h.api.prewarmChatWave(UUID,p,'https://signed.example/missing',20480);
 assert.equal(h.network,0,'native never downloads a second original just to draw bars');
});

test('large/unknown and cross-account waveform work remains bounded',async()=>{
 const h=harness(),p=UUID+'/large.m4a';let calls=0;
 await h.api.prewarmChatWave(UUID,p,'blob:huge',2*1024*1024+1,async()=>{calls++;return 'blob:huge'});
 assert.equal(calls,0);assert.equal(h.local,0);
 const other='8cb43ed6-958d-4d0a-9a32-d33686faf169';
 await h.api.prewarmChatWave(other,other+'/voice.m4a','blob:other',4096,async()=> 'blob:other');
 assert.equal(h.api.readChatWave(UUID,other+'/voice.m4a'),null);
});

test('VoicePlayer only warms visible small recordings, including incoming; no native double download',()=>{
 assert.match(PAGE,/CONNECT_ANDROID_INCOMING_VOICE_WAVE_CACHE_V1_20261116/);
 assert.match(PAGE,/IntersectionObserver/);
 assert.match(PAGE,/prewarmChatWave\(waveOwner,path,src,byteSize/);
 assert.doesNotMatch(PAGE,/prefetchChatAudio\(src,waveOwner,byteSize/,'waveform must reuse the played response');
 assert.equal((PAGE.match(/<VoicePlayer\s+src=\{attachmentUrls\[m\.attachment_path\]\}\s+path=\{m\.attachment_path\}\s+byteSize=\{m\.attachment_size\|\|0\}/g)||[]).length,2);
 assert.doesNotMatch(PAGE,/onPlay=\{\(\) => \{setPlaying\(true\);setError\(false\);setBuffering\(false\);void nativeWave\(\);\}\}/);
});
