const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),os=require('node:os'),path=require('node:path');
test('OTA guard accepts verified same-native APK and rejects v1, native drift and unverified baselines',async()=>{
 const {nativeBaseline}=await import('../scripts/release/config.mjs');const b={...nativeBaseline(),apkSha256:'1'.repeat(64)};
 const report='verification/parity/ota-compatibility.json',prior=fs.existsSync(report)?fs.readFileSync(report):null;
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'connect-ota-guard-'));const file=path.join(folder,'baseline.json');
 try{
  for(const [patch,pass] of [[{},true],[{runtime:'connect-android-ota-v1-sdk58'},false],[{nativeSha256:'0'.repeat(64)},false],[{certificateSha256:'0'.repeat(64)},false],[{apkSha256:null},false]]){
   fs.writeFileSync(file,JSON.stringify({...b,...patch}));const r=cp.spawnSync(process.execPath,['scripts/release/validate.mjs','ota',file],{encoding:'utf8'});assert.equal(r.status===0,pass,r.stderr);
  }
 }finally{fs.rmSync(folder,{recursive:true,force:true});if(prior)fs.writeFileSync(report,prior);else fs.rmSync(report,{force:true});}
});
test('release workflow is compact, uses checked sources and gates every publication',()=>{
 const yaml=require('js-yaml'),p='../.github/workflows/connect-android-parity-release.yml',text=fs.readFileSync(p,'utf8'),w=yaml.load(text);
 assert(fs.statSync(p).size<450000);assert.deepEqual(w.on.workflow_dispatch.inputs.mode.options,['check','ota','apk']);
 for(const job of ['ota','apk'])assert.equal(w.jobs[job].needs,'verify');
 assert.equal(w.jobs.apk.permissions.contents,'write');assert.equal(w.permissions.contents,'read');assert.equal(w.concurrency['cancel-in-progress'],false);
 assert.doesNotMatch(text,/git push|--force|\|\| true|<<'?(PY|JS|EOF)/);
 assert.match(text,/eas update --channel production --platform android --environment production/);
 assert.match(text,/scripts\/check_release_signing.py/);assert.match(text,/scripts\/release\/previous-apk.py/);
});
