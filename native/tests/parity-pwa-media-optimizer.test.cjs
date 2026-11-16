const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.join(__dirname,'../web');
const helper=fs.readFileSync(path.join(root,'lib/connect-media-optimizer.ts'),'utf8');
const page=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8');
const js=ts.transpileModule(helper.replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
const policy=new Function(js+'; return connectCanOptimizeMedia;')();
const fake=(name,type,size)=>({name,type,size});

test('media decisions preserve compressed originals, stickers, notes, native and no-op uploads',()=>{
  assert.equal(policy(fake('pic.jpg','image/jpeg',2e6),false),'image');
  assert.equal(policy(fake('pic.png','image/png',1e6),false),'image');
  assert.equal(policy(fake('animation.gif','image/gif',2e6),false),null);
  assert.equal(policy(fake('sticker-132.png','image/png',2e6),false),null);
  assert.equal(policy(fake('audio.wav','audio/wav',2e6),false),'wav');
  assert.equal(policy(fake('sound.mp3','audio/mpeg',2e6),false),null);
  assert.equal(policy(fake('voice.m4a','audio/mp4',2e6),false),null);
  assert.equal(policy(fake('clip.mp4','video/mp4',14e6),false),'video');
  assert.equal(policy(fake('connect-video-note-123.mp4','video/mp4',14e6),false),null);
  assert.equal(policy(fake('big.mp4','video/mp4',101*1024*1024),false),null);
  assert.equal(policy(fake('pic.jpg','image/jpeg',2e6),true),null);
});

test('single uploads and albums both prepare before thumbnail, upload and metadata; PWA recordings bounded',()=>{
  assert.equal((page.match(/await connectOptimizeMedia\(file,\s*\{native:isNativeMediaRuntime\(\)/g)||[]).length,2,'shared optimizer must apply to albums and single videos');
  const album=page.slice(page.indexOf('async function sendAlbum('),page.indexOf('async function sendAttachment('));
  const single=page.slice(page.indexOf('async function sendAttachment('),page.indexOf('async function beginRecording('));
  for(const [name,src] of [['album',album],['single',single]]){
    assert.ok(src.indexOf('await connectOptimizeMedia(') < src.indexOf('connectVideoFilePreview('),name+': prepare before poster');
    assert.ok(src.indexOf('await connectOptimizeMedia(') < src.indexOf("storage.from('connect-attachments').upload("),name+': prepare before upload');
  }
  assert.match(page,/audioBitsPerSecond:isNativeMediaRuntime\(\)\?64000:56000/);
  assert.match(page,/videoBitsPerSecond:isNativeMediaRuntime\(\)\?800000:720000/);
  assert.match(page,/!isNativeMediaRuntime\(\)\?\{audioBitsPerSecond:56000\}:\{\}/);
});

test('real Chromium: full photo compression, alpha preservation, originals and codec fallbacks',async()=>{
  const {chromium}=require('playwright-core');
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.setContent('<html><head></head><body></body></html>');
    await page.addScriptTag({content:js+'\nwindow.runOptimize=connectOptimizeMedia;'});
    const result=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=1780;canvas.height=1200;
      const ctx=canvas.getContext('2d');
      const pixels=ctx.createImageData(canvas.width,canvas.height);
      let seed=17;
      for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=i%20===0?0:255;}
      ctx.putImageData(pixels,0,0);
      const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const input=new File([png],'photo.png',{type:'image/png'});
      const result=await window.runOptimize(input);
      const out=result.file;
      let alpha=false;
      if(out!==input){const bitmap=await createImageBitmap(out);const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d');x.drawImage(bitmap,0,0);alpha=x.getImageData(0,0,1,1).data[3]<255;bitmap.close();}
      const gif=new File([new Uint8Array(2e6)],'animated.gif',{type:'image/gif'});
      const noGif=await window.runOptimize(gif);
      const raw=new File([new Uint8Array(16e6)],'video.mp4',{type:'video/mp4'});
      const originalIsReturned=(await window.runOptimize(raw)).file===raw;
      const native=(await window.runOptimize(input,{native:true})).file===input;
      return {input:input.size,output:out.size,mime:out.type,optimized:out!==input,alpha,noGif:noGif.file===gif,originalIsReturned,native};
    });
    assert.ok(result.optimized,'PNG must be optimized in Chromium');
    assert.ok(result.output <= result.input*.88,`expected meaningful saved bytes: ${JSON.stringify(result)}`);
    assert.equal(result.mime,'image/webp');
    assert.equal(result.alpha,true,'transparent pixels stay transparent');
    assert.equal(result.noGif,true);
    assert.equal(result.originalIsReturned,true,'MP4 unsupported encoder must retain its source');
    assert.equal(result.native,true);
    await page.close();
  }finally{await browser.close()}
});
