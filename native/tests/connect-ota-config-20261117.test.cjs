const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name));
const app=JSON.parse(read('app.json')).expo;
test('existing production Connect Android package and version remain intact',()=>{
  assert.equal(app.android.package,'com.connect.messenger');
  assert.equal(app.version,'3.0.6');
  assert.equal(app.android.versionCode,24);
});
test('Expo project ID and matching update endpoint are fixed',()=>{
  assert.equal(app.extra.eas.projectId,'430c7f08-3921-48d5-96d1-f7c3d686d3bf');
  assert.equal(app.updates.url,'https://u.expo.dev/'+app.extra.eas.projectId);
});
test('GitHub-built production binary sets the channel itself',()=>{
  assert.equal(app.updates.requestHeaders['expo-channel-name'],'production');
  assert.equal(app.updates.checkAutomatically,'ON_LOAD');
  assert.equal(app.updates.fallbackToCacheTimeout,0);
  assert.equal(app.updates.enabled,true);
});
test('native runtime is pinned and not derived from mutable JS changes',()=>{
  assert.equal(app.runtimeVersion,'connect-android-ota-v1-sdk58');
});
test('Expo Updates installed using an exact SDK-compatible version',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.match(pkg.dependencies['expo-updates'],/^\d+\.\d+\.\d+$/);
  assert.equal(pkg.dependencies['expo-updates'],JSON.parse(read('node_modules/expo-updates/package.json')).version);
});
test('release source lock matches all three approved edited inputs',()=>{
  const lock=JSON.parse(read('PARITY_SOURCE_LOCK.json'));
  for(const name of ['app.json','package.json','package-lock.json'])
    assert.equal(lock.files[name],crypto.createHash('sha256').update(read(name)).digest('hex'),name);
  assert.ok(Object.keys(lock.files).length>=370);
});
test('HTML is generated from embedded WebView source, never loaded remotely',()=>{
  const entry=read('src/App.tsx').toString();
  const embed=read('scripts/embed-web.mjs').toString();
  assert.match(entry,/import pwa from ['"]\.\/generated\/pwa['"]/);
  assert.match(embed,/src\/generated/);
  assert.match(entry,/baseUrl:CONNECT_ORIGIN/);
});
test('retains offline built-in sticker asset delivery',()=>{
  const plugin=read('plugins/withConnectWebAssets.js').toString();
  assert.match(plugin,/appassets\.androidplatform\.net/);
  assert.match(plugin,/copyPublicAssets/);
});
