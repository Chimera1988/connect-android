const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){
 const source=fs.readFileSync(require.resolve('../web/hybrid/runtime.ts'),'utf8'),tree=ts.createSourceFile('runtime.ts',source,99,true),names=new Set(['request','post','emit','discardFile']);
 const functions=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(tree)).join('\n');
 const sent=[],timers=[];const context={window:{__CONNECT_NONCE__:'a'.repeat(40),ReactNativeWebView:{postMessage:raw=>sent.push(JSON.parse(raw))}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return 1;},clearTimeout(){},Error,Map,Promise};
 vm.runInNewContext(ts.transpileModule('let serial=0;const pending=new Map();const transfers=new Map();const files=new Map();'+functions,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,context);
 return{context,sent,timers};
}
test('call bridge timeout identifies original operation and signals only its request ID',async()=>{
 const h=harness(),p=h.context.request('calls:dial',{conversationId:'fixture'}),check=assert.rejects(p,/подготовку исходящего звонка/);
 assert.equal(h.timers[0].ms,60000);h.timers[0].fn();await check;
 assert.equal(h.sent[1].command,'calls:timeout');assert.deepEqual(h.sent[1].payload,{requestId:'1',command:'calls:dial'});
});
test('unrelated timeout cannot dispatch a call cancellation',async()=>{
 const h=harness(),p=h.context.request('sounds:get'),check=assert.rejects(p,/sounds:get/);h.timers[0].fn();await check;assert.equal(h.sent.length,1);
});
