const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/nativeAppUtils.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,{exports:exportsObject,setTimeout,clearTimeout,Date,Promise});
const {messagePreview,listTime,withTimeout}=exportsObject;

test('forwarded text, albums and stickers never leak serialization into the inbox',()=>{
  assert.equal(messagePreview({body:'[[connect-forward:Alice]]\nHello\nthere'}),'Hello there');
  assert.equal(messagePreview({body:'[[connect-forward:Alice]]\n[[connect-album:[{},{}]]]'}),'Альбом (2)');
  assert.equal(messagePreview({body:'[[connect-forward:Alice]]\n[[connect-custom-sticker:123]]'}),'Стикер');
  assert.equal(messagePreview({body:'',attachment_kind:'image'}),'Фото');
  assert.equal(messagePreview({body:'',attachment_kind:'video',attachment_name:'connect-video-note-123.mp4'}),'Видеокружок');
  assert.equal(messagePreview({body:'secret',deleted_at:'2026-11-09'}),'Нет сообщений');
});

test('inbox dates distinguish today, yesterday and older messages',()=>{
  const now=new Date(2026,10,9,15);
  assert.match(listTime(new Date(2026,10,9,14,30).toISOString(),now),/14:30/);
  assert.equal(listTime(new Date(2026,10,8,9).toISOString(),now),'Вчера');
  assert.match(listTime(new Date(2026,10,1,9).toISOString(),now),/1/);
  assert.equal(listTime('invalid',now),'');
});

test('network timeout rejects hung requests but preserves successful and failed responses',async()=>{
  await assert.rejects(withTimeout(new Promise(()=>{}),5,'offline'),/offline/);
  assert.equal(await withTimeout(Promise.resolve(42),100,'offline'),42);
  await assert.rejects(withTimeout(Promise.reject(new Error('server rejected')),100,'offline'),/server rejected/);
});

test('all literal Connect SecureStore key fragments use Android-supported characters',()=>{
  let count=0;
  for(const filename of fs.readdirSync(path.join(__dirname,'../src')).filter(x=>/\.tsx?$/.test(x))){
    const ast=ts.createSourceFile(filename,fs.readFileSync(path.join(__dirname,'../src',filename),'utf8'),ts.ScriptTarget.Latest,true);
    const visit=node=>{
      if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
        if(/^connect-native-(?:cleared-chats|last-viewed-calls|chat-hidden|sticker-favorites|sticker-recent|read-marker)/.test(node.text)){
          count++;assert.match(node.text,/^[a-zA-Z0-9._-]+$/,filename+': '+node.text);
        }
      }
      ts.forEachChild(node,visit);
    };
    visit(ast);
  }
  assert.ok(count>=6,'scan must cover each previously broken persistent feature');
});
