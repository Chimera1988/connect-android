const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=[path.join(__dirname,'../components/ConnectCallsHub.tsx'),path.join(__dirname,'../web/components/ConnectCallsHub.tsx')].find(p=>fs.existsSync(p));
const text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile('hub.tsx',text,99,true,4),names=new Set(['callDuration','missed','statusText']);
const declarations=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(tree)).join('\n');
const policyExports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/call-missed.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports:policyExports,require:()=>require('../shared/call-missed-policy.json'),Date,Number});
const ctx={Date,missed:policyExports.isMissedIncomingCall};vm.runInNewContext(ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,ctx);
const sample={caller_id:'caller',callee_id:'callee',created_at:new Date(Date.now()-1000).toISOString(),answered_at:null,ended_at:new Date().toISOString()};
test('caller cancellation before answer is missed only for recipient',()=>{
 const c={...sample,status:'ended'};assert.equal(ctx.missed(c,'callee'),true);assert.equal(ctx.missed(c,'caller'),false);assert.match(ctx.statusText(c,'caller'),/отменён/);assert.equal(ctx.statusText(c,'callee'),'Пропущенный');
});
test('real ring expiry is missed only for the recipient; caller sees no answer',()=>{
 const c={...sample,status:'missed'};assert.equal(ctx.missed(c,'callee'),true);assert.equal(ctx.missed(c,'caller'),false);assert.equal(ctx.statusText(c,'callee'),'Пропущенный');assert.match(ctx.statusText(c,'caller'),/без ответа/);
});
test('decline and local preparation failure never inflate missed badge',()=>{
 for(const status of ['declined','failed','busy'])assert.equal(ctx.missed({...sample,status},'callee'),false);
 assert.match(ctx.statusText({...sample,status:'declined'},'callee'),/Отклонённый/);
 assert.match(ctx.statusText({...sample,status:'failed'},'caller'),/соединение не удалось/);
});
