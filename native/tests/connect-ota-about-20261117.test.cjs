const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('src/App.tsx'),proto=read('src/hybridProtocol.ts'),web=read('web/app/page.tsx'),ui=read('web/components/ConnectOtaSettings.tsx');
const cfg=JSON.parse(read('app.json')).expo,lock=JSON.parse(read('PARITY_SOURCE_LOCK.json'));
test('Connect Android About never uses a stale literal version',()=>{
  assert.doesNotMatch(web,/Версия 3\.0\.6 \(24\)/);
  assert.match(web,/<ConnectOtaSettings\/>/);
  assert.match(app,/Constants\.expoConfig\?\.version/);
  assert.match(app,/Constants\.platform\?\.android\?\.versionCode/);
  assert.match(ui,/Версия \{info\?\.version/);
});
test('strict nonce-bound bridge validates all four OTA commands with no arbitrary payload',()=>{
  for(const op of ['info','check','download','apply']){
    assert.match(proto,new RegExp("'updates:"+op+"'"));
    assert.match(app,new RegExp("case 'updates:"+op+"'"));
  }
  assert.match(proto,/case 'updates:info':case 'updates:check':case 'updates:download':case 'updates:apply':return fields\(value,\[\]\)/);
  assert.match(proto,/isTrustedHybridUrl\(sourceUrl\)/);
});
test('Expo OTA uses the installed production channel and unchanged 3.0.7 runtime',()=>{
  assert.equal(cfg.android.package,'com.connect.messenger');
  assert.equal(cfg.version,'3.0.7');assert.equal(cfg.android.versionCode,25);
  assert.equal(cfg.runtimeVersion,'connect-android-ota-v1-sdk58');
  assert.equal(cfg.updates.requestHeaders['expo-channel-name'],'production');
  assert.equal(cfg.extra.eas.projectId,'430c7f08-3921-48d5-96d1-f7c3d686d3bf');
  assert.match(app,/Updates\.checkForUpdateAsync\(\)/);
  assert.match(app,/Updates\.fetchUpdateAsync\(\)/);
  assert.match(app,/Updates\.reloadAsync\(\)/);
});
test('A busy call or recording prevents unexpected OTA restart',()=>{
  assert.match(app,/voiceRef\.current\.phase!==\x27idle\x27\|\|recordingActive\.current/);
  assert.match(app,/saves\.current\.size\|\|fileTransfers\.current\.size/);
  assert.match(ui,/Применить и перезапустить/);
  assert.match(ui,/Обновления по воздуху|Обновление приложения/);
});
test('No private Expo credentials or remote WebView injected in OTA UI',()=>{
  assert.doesNotMatch(ui,/EXPO_TOKEN|SERVICE_ROLE_KEY|fetch\(/);
  assert.match(ui,/window\.ConnectNative/);
  assert.match(app,/baseUrl:CONNECT_ORIGIN/);
});
test('All changed and newly added sources are in the integrity lock',()=>{
  const crypto=require('node:crypto');
  for(const name of ['src/App.tsx','src/hybridProtocol.ts','web/app/page.tsx','web/hybrid/android.css','web/components/ConnectOtaSettings.tsx','package.json','package-lock.json','tests/connect-ota-about-20261117.test.cjs']){
    assert.equal(lock.files[name],crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),name);
  }
  assert.ok(Object.keys(lock.files).length>=375);
});
