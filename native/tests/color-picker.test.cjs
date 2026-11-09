const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/nativeColorUtils.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:exportsObject});
const {hexToHsv,hsvToHex,unit}=exportsObject;

test('arbitrary palette covers the hue circle and achromatic endpoints',()=>{
  const colors=['#ff0000','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff'];
  colors.forEach((hex,index)=>{
    assert.equal(hsvToHex({h:index*60,s:1,v:1}),hex);
    assert.equal(hexToHsv(hex).h,index*60);
  });
  assert.equal(hsvToHex({h:210,s:0,v:1}),'#ffffff');
  assert.equal(hsvToHex({h:210,s:1,v:0}),'#000000');
  assert.equal(hsvToHex({h:210,s:0,v:.5}),'#808080');
});

test('HEX and HSV round trip without changing arbitrary saved accent colors',()=>{
  for(const red of [0,17,128,254,255])for(const green of [0,17,128,254,255])for(const blue of [0,17,128,254,255]){
    const hex='#'+[red,green,blue].map(channel=>channel.toString(16).padStart(2,'0')).join('');
    assert.equal(hsvToHex(hexToHsv(hex)),hex);
  }
  assert.equal(hsvToHex(hexToHsv('#ABC')),'#aabbcc');
  assert.equal(hsvToHex(hexToHsv('#087dff')),'#087dff');
});

test('invalid color input is rejected and out-of-bounds gestures remain valid colors',()=>{
  for(const input of ['',' #','blue','#12','#12345','#12345678','#ff00gg'])assert.equal(hexToHsv(input),null);
  assert.equal(hsvToHex({h:-60,s:1,v:1}),'#ff00ff');
  assert.equal(hsvToHex({h:360,s:1,v:1}),'#ff0000');
  assert.equal(hsvToHex({h:720,s:2,v:2}),'#ff0000');
  assert.equal(hsvToHex({h:NaN,s:Infinity,v:NaN}),'#000000');
  assert.equal(unit(-.1),0);assert.equal(unit(1.1),1);assert.equal(unit(.42),.42);
});
