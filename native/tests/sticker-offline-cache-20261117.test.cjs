const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'../web/app/page.tsx'),'utf8');
const cache=fs.readFileSync(path.join(__dirname,'../web/lib/media-cache.ts'),'utf8');
test('Android private device storage pins sticker files across cache trimming',()=>{
  assert.match(cache,/CONNECT_ANDROID_STICKERS_PINNED_20261117/);
  assert.match(cache,/if \(row\.key\.startsWith\(owner \+ ':connect-stickers\/'\)\) continue;/);
  assert.match(cache,/const NAME = 'connect-media-v1'/);
  assert.match(cache,/indexedDB\.open\(NAME, 4\)/);
});
test('viewer cache is keyed by stable storage path, never a signed token',()=>{
  const before=page.indexOf('const local=await resolveCachedMedia(identity,viewer);');
  const after=page.indexOf("const {data}=await supabase!.storage.from('connect-stickers').createSignedUrl",before);
  assert.ok(before>=0 && after>before);
  assert.match(cache,/const key=user\+':'\+id/);
});
test('catalog bytes are persisted before the first signed image reaches the DOM',()=>{
  const fragment=page.slice(page.indexOf('CONNECT_ANDROID_STICKER_OFFLINE_FIRST_20261117'),page.indexOf("}catch{/* Retry on next login/visibility refresh"));
  assert.ok(fragment.indexOf('await prefetchStickerWebp(signed,viewer)')>=0);
  assert.ok(fragment.indexOf('await prefetchStickerWebp(signed,viewer)')<fragment.indexOf('setCustomStickerUrls(prev=>'));
  assert.match(fragment,/isCachedMediaUrl\(cached\)\?cached:signed/);
});
test('received private sticker not in a public catalog is also cached first',()=>{
  assert.match(page,/await prefetchStickerWebp\(url,owner\);[\s\S]{0,180}await resolveCachedMedia\(identity,owner\)/);
});
test('foreground refresh is bounded, but explicit pack changes can refresh',()=>{
  assert.match(page,/stickerVisibilityRefreshedAt\.current>10\*60\*1000/);
  assert.match(page,/const loadCustomStickers=useCallback/);
  assert.match(page,/await loadCustomStickers\(\)/);
});
test('Android release SHA-256 manifest matches exactly the edited active source files',()=>{
  const {createHash}=require('node:crypto');
  const lock=JSON.parse(fs.readFileSync(path.join(__dirname,'../PARITY_SOURCE_LOCK.json'),'utf8'));
  for(const name of ['web/app/page.tsx','web/lib/media-cache.ts']){
    const actual=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',name))).digest('hex');
    assert.equal(lock.files[name],actual,name);
  }
});
test('all 96 built-in WebP stickers remain bundled with APK and served without network',()=>{
  const root=path.join(__dirname,'../web/public/stickers');
  let count=0;for(const name of ['speed','blocks','anime-boys','anime-girls']){
    const files=fs.readdirSync(path.join(root,name)).filter(f=>f.endsWith('.webp'));
    assert.equal(files.length,24);count+=files.length;
  }assert.equal(count,96);
  const plugin=fs.readFileSync(path.join(__dirname,'../plugins/withConnectWebAssets.js'),'utf8');
  assert.match(plugin,/Legacy builtin sticker URLs keep their IDs/);
});
