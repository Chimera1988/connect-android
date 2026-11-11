const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=[path.join(__dirname,'../components/ConnectCallsHub.tsx'),path.join(__dirname,'../web/components/ConnectCallsHub.tsx')].find(p=>fs.existsSync(p));
const text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile('hub.tsx',text,99,true,4),names=new Set(['callDuration','missed','statusText']);
const declarations=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(tree)).join('\n');
const ctx={Date};vm.runInNewContext(ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,ctx);
const sample={caller_id:'caller',callee_id:'callee',created_at:new Date(Date.now()-1000).toISOString(),answered_at:null,ended_at:new Date().toISOString()};
test('local caller cancellation is not a missed incoming call on either device',()=>{
 const c={...sample,status:'ended'};assert.equal(ctx.missed(c,'callee'),false);assert.equal(ctx.missed(c,'caller'),false);assert.match(ctx.statusText(c,'caller'),/отменён/);assert.match(ctx.statusText(c,'callee'),/отменён/);
});
test('real ring expiry is missed only for the recipient; caller sees no answer',()=>{
 const c={...sample,status:'missed'};assert.equal(ctx.missed(c,'callee'),true);assert.equal(ctx.missed(c,'caller'),false);assert.equal(ctx.statusText(c,'callee'),'Пропущенный');assert.match(ctx.statusText(c,'caller'),/без ответа/);
});
test('decline and local preparation failure never inflate missed badge',()=>{
 for(const status of ['declined','failed','busy'])assert.equal(ctx.missed({...sample,status},'callee'),false);
 assert.match(ctx.statusText({...sample,status:'declined'},'callee'),/Отклонённый/);
 assert.match(ctx.statusText({...sample,status:'failed'},'caller'),/соединение не удалось/);
});
