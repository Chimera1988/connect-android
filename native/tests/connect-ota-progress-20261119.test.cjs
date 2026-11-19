const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const native=read('src/App.tsx');
const runtime=read('web/hybrid/runtime.ts');
const ui=read('web/components/ConnectOtaSettings.tsx');
const css=read('web/hybrid/android.css');

test('OTA fraction comes from Expo useUpdates and is bounded to [0,1]',()=>{
  assert.match(native,/const otaState=Updates\.useUpdates\(\)/);
  assert.match(native,/otaState\.downloadProgress/);
  assert.match(native,/otaState\.isDownloading/);
  assert.match(native,/Number\.isFinite\(raw\)/);
  assert.match(native,/Math\.min\(1,Math\.max\(0,raw\)\)/);
  assert.match(native,/send\('ota-progress',\{downloading:otaState\.isDownloading,progress:fraction\}\)/);
  assert.match(native,/downloadProgress:otaStateRef\.current\.isDownloading/);
  assert.doesNotMatch(native,/setInterval\([^\n]*ota-progress/);
});

test('existing nonce-bound bridge sends native progress events without adding arbitrary commands',()=>{
  assert.match(native,/\['call','sounds','lifecycle','chat','native-session','ota-progress'\]/);
  assert.match(runtime,/if\(type==='ota-progress'\)/);
  assert.match(runtime,/new CustomEvent\('connect:ota-progress',\{detail:data\}\)/);
  assert.doesNotMatch(ui,/EXPO_TOKEN|SERVICE_ROLE_KEY|fetch\(/);
});

test('OTA UI displays real percentages, accessible progress, and unknown progress without fake data',()=>{
  assert.match(ui,/function validFraction\(value:unknown\):number\|null/);
  assert.match(ui,/Number\.isFinite\(value\)/);
  assert.match(ui,/setDownloadFraction\(old=>Math\.max\(old\?\?0,fraction\)\)/);
  assert.match(ui,/progressPercent=state==='ready'\?100:state==='downloading'/);
  assert.match(ui,/role="progressbar"/);
  assert.match(ui,/aria-valuenow=\{progressPercent===null\?undefined:progressPercent\}/);
  assert.match(ui,/Загружено \$\{progressPercent\}%/);
  assert.match(ui,/процент пока недоступен/);
  assert.match(ui,/state==='ready'\?'Загружено 100%/);
  assert.match(ui,/case 'updates:download'|updates:download/);
  assert.doesNotMatch(ui,/setInterval|setTimeout|Math\.random/);
});

test('progress indicator is accessible, dark-theme compatible and reduced-motion aware',()=>{
  assert.match(css,/connect-ota-progress-track/);
  assert.match(css,/connect-ota-progress-fill/);
  assert.match(css,/connect-ota-sweep/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('all changed sources and this test are hash-locked',()=>{
  const lock=JSON.parse(read('PARITY_SOURCE_LOCK.json'));
  for(const name of ['src/App.tsx','web/hybrid/runtime.ts','web/components/ConnectOtaSettings.tsx','web/hybrid/android.css','tests/connect-ota-progress-20261119.test.cjs']){
    const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
    assert.equal(lock.files[name],digest,name);
  }
});
