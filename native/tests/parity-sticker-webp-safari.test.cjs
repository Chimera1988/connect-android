const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');

const source=fs.readFileSync('web/lib/sticker-webp.ts','utf8');
const page=fs.readFileSync('web/app/page.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const fakeWebp=Buffer.from('RIFF1234WEBP111');
const fakePng=Buffer.from([137,80,78,71,13,10,26,10,33,44,55,66,77]);
class BrowserFile extends Blob {constructor(parts,name,opts={}){super(parts,opts);this.name=name;this.lastModified=opts.lastModified||0;}}
function setup(mime='image/png',bytes=fakePng){
  const observed={dimensions:[],fallback:0,revoked:0};
  class FakeImage {constructor(){this.naturalWidth=1200;this.naturalHeight=600;}
    set src(_url){queueMicrotask(()=>this.onload?.());}}
  const canvas={width:0,height:0,
    getContext:()=>({drawImage:()=>observed.dimensions.push([canvas.width,canvas.height])}),
    toBlob:callback=>callback(new Blob([bytes],{type:mime}))};
  const context={exports:{},Blob,File:BrowserFile,Image:FakeImage,
    URL:{createObjectURL:()=> 'blob:sticker',revokeObjectURL:()=>{observed.revoked++;}},
    document:{createElement:kind=>{assert.equal(kind,'canvas');return canvas;}}};
  vm.runInNewContext(compiled,context);
  return {fn:context.exports.prepareStickerFile,observed};
}
function sourceJpg(){return new BrowserFile([fakePng],'cat.jpg',{type:'image/jpeg',lastModified:77});}

test('REGRESSION: Safari returns PNG from canvas.toBlob(image/webp), fallback returns genuine WebP',async()=>{
  for(const [name,mime] of [['cat.jpg','image/jpeg'],['cat.png','image/png']]){
    const {fn,observed}=setup('image/png',fakePng);
    const f=new BrowserFile([fakePng],name,{type:mime,lastModified:77});
    const answer=await fn(f,async src=>{
      assert.equal(src,f);observed.fallback++;return new Blob([fakeWebp],{type:'image/webp'});
    });
    assert.equal(observed.fallback,1);
    assert.equal(answer.type,'image/webp');
    assert.equal(answer.name,'cat.webp');
    assert.equal(answer.lastModified,77);
    assert.deepEqual(observed.dimensions,[[512,256]]);
    assert.equal(observed.revoked,1);
    assert.deepEqual(Buffer.from(await answer.arrayBuffer()),fakeWebp);
  }
});
test('PNG bytes with mislabeled image/webp are never uploaded',async()=>{
  const {fn}=setup('image/webp',fakePng);
  let calls=0;
  const f=sourceJpg();
  const answer=await fn(f,async()=>{calls++;return new Blob([fakeWebp],{type:'image/webp'});});
  assert.equal(calls,1);
  assert.equal(answer.type,'image/webp');
});
test('server must return actual WebP, not a PNG or 2MB-plus file',async()=>{
  const {fn}=setup();
  await assert.rejects(fn(sourceJpg(),async()=>new Blob([fakePng],{type:'image/png'})),/Сервер не вернул корректный WebP/);
});
test('native WebP succeeds without a network fallback',async()=>{
  const {fn,observed}=setup('image/webp',fakeWebp);
  const answer=await fn(sourceJpg(),async()=>{throw Error('Unexpected fallback request');});
  assert.equal(answer.type,'image/webp');
  assert.equal(observed.fallback,0);
});
test('animated GIF and existing WebP remain unchanged',async()=>{
  const {fn}=setup();
  for(const [name,type] of [['animation.gif','image/gif'],['image.webp','image/webp']]){
    const file=new BrowserFile(['data'],name,{type});
    assert.equal(await fn(file),file);
  }
});
test('PWA passes authenticated fallback to both sticker pack and keyboard favorite uploads',()=>{
  assert(!page.includes("supabase.functions.invoke('connect-sticker-webp-convert'"));
  assert(page.includes('convertStickerWebpOnServer(file,{'));
  assert(page.includes('transport:supabaseFetch,'));
  assert(page.includes('prepareStickerFile(file,convertStickerOnServer)'));
  assert(page.includes('),convertStickerOnServer);'));
  assert(!page.includes('window.setTimeout(()=>document.getElementById(\'connect-sticker-upload\')'));
  const program=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  assert.equal(program.parseDiagnostics.length,0,program.parseDiagnostics.map(x=>x.messageText).join('\n'));
});
