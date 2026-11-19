'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('settings menu grouping is derived from semantic item ids, not child positions', () => {
  const page = read('web/app/page.tsx');
  const css = read('web/app/liquid-glass.css');
  assert.match(page,/settingsMenuSegmentClasses\(items,i\)/);
  assert.match(page,/\.map\(\(item,i,items\)=>/);
  assert.match(css,/\.settings-menu\s*>\s*div\.settings-segment-start/);
  assert.match(css,/\.settings-menu\s*>\s*div\.settings-segment-end/);
  assert.doesNotMatch(css,/\.settings-menu\s*>\s*div:nth-child\(/);

});

test('rounded groups stay correct with and without administrator-only rows',()=>{
  const ts = require('typescript');
  const helper = read('web/lib/settings-menu-groups.ts');
  const js = ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module = {exports:{}};
  Function('module','exports',js)(module,module.exports);
  const apply = ids => ids.map(id=>({id})).map((_,i,a)=>module.exports.settingsMenuSegmentClasses(a,i));
  const start = 'settings-segment-start';
  const end = 'settings-segment-end';
  assert.deepEqual(apply(['appearance','stickers','notifications','data','privacy','about']),[
    start,end,start,'',end,start+' '+end
  ]);
  assert.deepEqual(apply(['appearance','stickers','members','usage','notifications','data','privacy','about']),[
    start,end,start,end,start,'',end,start+' '+end
  ]);
});
