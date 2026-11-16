const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../web/lib/avatar-directory-cache.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.deepEqual(compiled.diagnostics||[],[], 'avatar cache coordinator must transpile');
const mod={exports:{}};
new Function('module','exports',compiled.outputText)(mod,mod.exports);
const {createAvatarDirectoryCache}=mod.exports;
const app=fs.readFileSync(path.join(__dirname,'../web/app/page.tsx'),'utf8');
const media=fs.readFileSync(path.join(__dirname,'../web/lib/media-cache.ts'),'utf8');

test('100 repeated directory reads reuse one signed avatar and one JPEG GET',async()=>{
 const cache=createAvatarDirectoryCache();const bytes=new Map();let signs=0,gets=0;
 const io={
  readCached:async p=>bytes.get(p)||null,
  signBatch:async paths=>{signs++;return Object.fromEntries(paths.map(p=>[p,`https://example.test/${p}?sig=${signs}`]));},
  warm:async url=>{gets++;const p=new URL(url).pathname.slice(1);bytes.set(p,`blob:${p}`);}
 };
 const people=[{id:'alice',avatar_path:'user-a/avatar.jpg'}];
 for(let i=0;i<100;i++){
  const r=await cache.resolve('viewer-a',people,io);
  assert.equal(r.alice,'blob:user-a/avatar.jpg');
 }
 assert.equal(signs,1);
 assert.equal(gets,1);
});

test('overlapping directory refreshes share one signed batch',async()=>{
 const cache=createAvatarDirectoryCache();const bytes=new Map();let signs=0,gets=0;
 const io={readCached:async p=>bytes.get(p)||null,
  signBatch:async paths=>{signs++;await new Promise(r=>setTimeout(r,5));return Object.fromEntries(paths.map(p=>[p,`https://example.test/${p}`]));},
  warm:async url=>{gets++;bytes.set(new URL(url).pathname.slice(1),'blob:ready');}};
 const people=[{id:'a',avatar_path:'a.jpg'}];
 const results=await Promise.all(Array.from({length:12},()=>cache.resolve('viewer-a',people,io)));
 assert(results.every(r=>r.a==='blob:ready'));
 assert.equal(signs,1);assert.equal(gets,1);
});

test('cache is private per viewer and rotated avatar paths get new bytes',async()=>{
 const cache=createAvatarDirectoryCache();let signs=0;const bytes=new Map();
 const io={readCached:async p=>bytes.get(p)||null,
  signBatch:async paths=>{signs++;return Object.fromEntries(paths.map(p=>[p,`https://example.test/${p}`]));},
  warm:async url=>bytes.set(new URL(url).pathname.slice(1),'blob:'+signs)};
 await cache.resolve('viewer-a',[{id:'a',avatar_path:'old.jpg'}],io);
 await cache.resolve('viewer-a',[{id:'a',avatar_path:'new.jpg'}],io);
 assert.equal(signs,2);
 bytes.clear();
 await cache.resolve('viewer-b',[{id:'a',avatar_path:'old.jpg'}],io);
 assert.equal(signs,3,'viewer-b must never reuse viewer-a signed URL');
});

test('prewarm is limited to 8 avatars, fallback remains usable for additional contacts',async()=>{
 const cache=createAvatarDirectoryCache();let prewarm=0;
 const people=Array.from({length:24},(_,i)=>({id:String(i),avatar_path:`${i}.jpg`}));
 const r=await cache.resolve('viewer',people,{
  readCached:async()=>null,
  signBatch:async paths=>Object.fromEntries(paths.map(p=>[p,`https://example.test/${p}`])),
  warm:async()=>{prewarm++;}
 });
 assert.equal(prewarm,8);assert.equal(Object.keys(r).length,24);
});

test('native video scroll never creates decoder of the original when its poster is missing',()=>{
 assert.match(app,/near&&posterChecked&&!uploadedPoster&&!poster&&isNativeMediaRuntime\(\)&&<span className="connect-video-fallback"/);
 assert.match(app,/near&&posterChecked&&!uploadedPoster&&!poster&&!isNativeMediaRuntime\(\)&&<video/);
});

test('native chat never silently replaces a missing JPEG preview with the full-size image',()=>{
 assert.match(app,/if\(isNativeMediaRuntime\(\)&&preview===null\)return undefined;/);
 assert.match(app,/photoPreviews\[m\.attachment_path!\]===null\?'Открыть фото'/);
});

test('Android keeps voice/video bounded and user-account media-cache identities',()=>{
 assert.match(app,/preload="none"/);
 assert.equal((app.match(/userPaused=useRef\(isNativeMediaRuntime\(\)\)/g)||[]).length,2,'both native inline videos and video notes must wait for an explicit tap');
 assert.match(app,/prefetchChatAudio\(url,viewer,meta\.attachment_size\)/);
 assert.match(media,/cacheLeaseValid\(user,epoch\)/);
 assert.match(media,/id\.startsWith\('connect-avatars\/'\)\?1024\*1024:512\*1024/);
});
