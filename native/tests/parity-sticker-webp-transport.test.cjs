// CONNECT_PWA_STICKER_BINARY_TRANSPORT_FIX4_20261115
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root=path.join(__dirname,'../web');
const code=fs.readFileSync(path.join(root,'lib/sticker-webp-transport.ts'),'utf8');
const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const sandbox={exports:{},Blob,File,Uint8Array,ArrayBuffer,Response,fetch,console};
vm.runInNewContext(compiled,sandbox,{filename:'sticker-webp-transport.js'});
const convert=sandbox.exports.convertStickerWebpOnServer;
const url='https://project.supabase.co/functions/v1/connect-sticker-webp-convert';
const config={endpoint:url,accessToken:'test-session-token',apiKey:'test-publishable',transport:undefined};
const goodWebP=Uint8Array.from([82,73,70,70,12,0,0,0,87,69,66,80,86,80,56,76,1,2,3,4]);
const file=(name,bytes,mime)=>new File([Uint8Array.from(bytes)],name,{type:mime});
function okResponse(){return new Response(goodWebP,{status:200,headers:{'Content-Type':'application/octet-stream','X-Connect-Media-Type':'image/webp'}});}
for(const [name,signature,mime] of [
  ['cat.jpg',[255,216,255,224,0,16,74,70,73,70,0,1,0,0,1],'image/jpeg'],
  ['cat.png',[137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82],'image/png']
])test('transmits all binary bytes for '+name+' (never an empty request)',async()=>{
  const source=file(name,signature,mime);
  let calls=0;
  const result=await convert(source,{...config,transport:async(input,options)=>{
    calls++;
    assert.equal(input,url);
    assert.equal(options.method,'POST');
    assert.equal(options.headers.Authorization,'Bearer test-session-token');
    assert.equal(options.headers.apikey,'test-publishable');
    assert.equal(options.headers['Content-Type'],'application/octet-stream');
    assert.ok(options.body instanceof ArrayBuffer,'A copied ArrayBuffer is required for Safari');
    assert.equal(options.body.byteLength,source.size,'payload size must equal file size');
    assert.deepEqual(Buffer.from(options.body),Buffer.from(signature));
    // Prove browser fetch Request can consume these same exact bytes.
    const request=new Request(input, options);
    assert.deepEqual(Buffer.from(await request.arrayBuffer()),Buffer.from(signature));
    return okResponse();
  }});
  assert.equal(calls,1);
  assert.equal(result.type,'image/webp');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()),Buffer.from(goodWebP));
});
test('rejects an empty file before making a network request',async()=>{
  let called=false;
  await assert.rejects(convert(new File([],'empty.png',{type:'image/png'}),{...config,transport:async()=>{called=true;return okResponse();}}),/пуст|размер|12 МБ/i);
  assert.equal(called,false);
});
test('rejects missing user session instead of silently sending invalid auth',async()=>{
  await assert.rejects(convert(file('cat.jpg',[255,216,255],'image/jpeg'),{...config,accessToken:''}),/авториз|войдите/i);
});
test('reports HTTP 413 and a server-provided error rather than generic non-2xx',async()=>{
  await assert.rejects(convert(file('cat.jpg',[255,216,255],'image/jpeg'),{...config,transport:async()=>new Response(JSON.stringify({error:'Image payload is empty'}),{status:413,headers:{'content-type':'application/json'}})}),/413.*Image payload is empty/);
});
test('does not accept a renamed fake WebP or a missing media header',async()=>{
  const badData=new Response(new Blob([new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12])]),{status:200,headers:{'Content-Type':'application/octet-stream','X-Connect-Media-Type':'image/webp'}});
  await assert.rejects(convert(file('cat.png',[1,2,3],'image/png'),{...config,transport:async()=>badData}),/WebP/i);
  await assert.rejects(convert(file('cat.png',[1,2,3],'image/png'),{...config,transport:async()=>new Response(goodWebP,{status:200,headers:{'Content-Type':'application/octet-stream'}})}),/WebP/i);
});
test('page integrates the binary transport rather than invoking Supabase Functions with File',()=>{
  const page=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8');
  assert(page.includes('convertStickerWebpOnServer('),'Page must call verified transport helper');
  assert(!page.includes("supabase.functions.invoke('connect-sticker-webp-convert'"),'Old zero-byte invoke must not remain');
  assert(page.includes('prepareStickerFile(file,convertStickerOnServer)'),'Upload fallback still wired');
  assert(page.includes('),convertStickerOnServer);'),'iOS favorites fallback still wired');
});
