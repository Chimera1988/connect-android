// CONNECT_PWA_STICKER_WEBP_EDITOR_20261115 - focused no-network regression tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/lib/sticker-webp.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
class BrowserFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified ?? 0;
  }
}
function makeContext() {
  const drawings = [];
  let revoked = 0;
  class FakeImage {
    constructor() { this.naturalWidth = 1200; this.naturalHeight = 600; }
    set src(_) { queueMicrotask(() => this.onload?.()); }
  }
  const context = {
    exports: {}, Blob, File: BrowserFile, Image: FakeImage,
    URL: { createObjectURL: () => 'blob:sticker-test', revokeObjectURL: () => { revoked++; } },
    document: { createElement: (name) => {
      assert.equal(name, 'canvas');
      const canvas = { width: 0, height: 0,
        getContext: () => ({ drawImage: () => { drawings.push([canvas.width, canvas.height]); } }),
        toBlob: (callback, mime) => callback(new Blob([Buffer.from('RIFF1234WEBP')], { type: mime })) };
      return canvas;
    } },
  };
  vm.runInNewContext(compiled, context);
  return { prepare: context.exports.prepareStickerFile, drawings, get revoked() { return revoked; } };
}
test('JPG and PNG convert to real WebP MIME and resize proportionally', async () => {
  for (const [name,type] of [['photo.jpg','image/jpeg'],['sticker.png','image/png']]) {
    const c = makeContext();
    const input = new BrowserFile(['original'],name,{type,lastModified:1234});
    const result = await c.prepare(input);
    assert.equal(result.type, 'image/webp');
    assert.equal(result.name, name.replace(/\.[^.]+$/,'.webp'));
    assert.equal(result.lastModified, 1234);
    assert.equal(c.drawings.length,1);
    assert.deepEqual(c.drawings[0],[512,256]);
    assert.equal(c.revoked,1);
  }
});
test('GIF and WebP remain original, preserving animation and existing pixels', async () => {
  const c = makeContext();
  for (const [name,type] of [['animated.gif','image/gif'],['sticker.webp','image/webp']]) {
    const input = new BrowserFile(['bytes'],name,{type});
    assert.equal(await c.prepare(input),input);
  }
  assert.equal(c.drawings.length,0);
});
test('rejects SVG, zero size, over-limit files and large animation', async () => {
  const c = makeContext();
  await assert.rejects(c.prepare(new BrowserFile(['<svg/>'],'bad.svg',{type:'image/svg+xml'})),/JPG, PNG/);
  await assert.rejects(c.prepare(new BrowserFile([],'empty.png',{type:'image/png'})),/12 МБ/);
  await assert.rejects(c.prepare(new BrowserFile([Buffer.alloc(2*1024*1024+1)],'big.gif',{type:'image/gif'})),/2 МБ/);
});
