'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('src/ConnectApkUpdates.ts');
const transpiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('module','exports',transpiled)(mod,mod.exports);
const parse=mod.exports.parseConnectApkRelease;
const valid=(version='3.0.8',build=26)=>({
 tag_name:`connect-android-v${version}-b${build}`,draft:false,prerelease:false,
 assets:[{name:'Connect.apk',state:'uploaded',size:48_000_000,digest:'sha256:'+'a'.repeat(64),
 browser_download_url:`https://github.com/Chimera1988/connect-android/releases/download/connect-android-v${version}-b${build}/Connect.apk`}]
});
test('GitHub Releases: strictly newer verified candidate only',()=>{
 const result=parse(valid(),25);
 assert.equal(result.state,'available');assert.equal(result.build,26);
 assert.equal(result.candidate.url,valid().assets[0].browser_download_url);
 assert.equal(result.candidate.sha256,'a'.repeat(64));
 assert.equal(parse(valid(),26).state,'current');
 assert.equal(parse(valid('3.0.7',25),26).state,'current');
 assert.equal(parse(valid('3.0.7',25),25).state,'current');
});
test('refuse spoofed, ambiguous, corrupt or unsigned external APK assets',()=>{
 const attacks=[
  x=>{x.assets[0].browser_download_url='https://evil.example/Connect.apk';},
  x=>{x.assets[0].digest=null;},
  x=>{x.assets[0].digest='sha256:'+'b'.repeat(60);},
  x=>{x.assets[0].size=10;},
  x=>{x.assets[0].state='starter';},
  x=>{x.assets.push({...x.assets[0]});},
  x=>{x.tag_name='connect-android-v3.0.8-b26/../../';},
  x=>{x.tag_name='v3.0.8';},
  x=>{x.draft=true;},
  x=>{x.prerelease=true;},
  x=>{x.assets[0].name='evil.apk';},
 ];
 for(const alter of attacks){const data=valid();alter(data);assert.throws(()=>parse(data,25));}
 assert.throws(()=>parse(valid(),0));
 assert.throws(()=>parse(valid(),NaN));
});
test('real Android bridge provides no arbitrary URL/payload to native APK download',()=>{
 const app=read('src/App.tsx'),proto=read('src/hybridProtocol.ts'),ui=read('web/components/ConnectOtaSettings.tsx');
 for(const op of ['apk-check','apk-open']){
  assert.match(app,new RegExp(`case 'updates:${op}'`));
  assert.match(proto,new RegExp(`'updates:${op}'`));
  assert.match(ui,new RegExp(`updates:${op}`));
 }
 assert.match(app,/checkConnectApkRelease\(installedBuild\)/);
 assert.match(app,/apkCandidate\.current/);
 assert.match(proto,/updates:apk-check':case 'updates:apk-open':return fields\(value,\[\]\)/);
 assert.doesNotMatch(ui,/fetch\(|EXPO_TOKEN|SERVICE_ROLE_KEY/);
 assert.match(app,/voiceRef\.current\.phase!==['"]idle['"]\|\|recordingActive\.current/);
});
test('source integrity covers every modified and new file',()=>{
 const lock=JSON.parse(read('PARITY_SOURCE_LOCK.json'));
 const crypto=require('node:crypto');
 for(const name of ['src/App.tsx','src/hybridProtocol.ts','src/ConnectApkUpdates.ts',
   'web/components/ConnectOtaSettings.tsx','tests/connect-apk-update-20261117.test.cjs']){
  assert.equal(lock.files[name],crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),name);
 }
 assert.equal(JSON.parse(read('app.json')).expo.android.versionCode,25);
 assert.ok(Object.keys(lock.files).length>=377);
});
