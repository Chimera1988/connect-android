const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
test('source lock is repeatable and rejects modified or missing reviewed sources',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'connect-source-lock-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));fs.copyFileSync('scripts/check-parity-source.mjs',path.join(root,'scripts/check-parity-source.mjs'));
  const text='reviewed';fs.writeFileSync(path.join(root,'source.ts'),text);
  fs.writeFileSync(path.join(root,'PARITY_SOURCE_LOCK.json'),JSON.stringify({pwaSha:'reference',files:{'source.ts':crypto.createHash('sha256').update(text).digest('hex')}}));
  fs.writeFileSync(path.join(root,'app.json'),JSON.stringify({expo:{version:'3.0.7',android:{package:'com.connect.messenger',versionCode:25},plugins:[['expo-build-properties',{android:{minSdkVersion:29}}]]}}));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{expo:'~58.0.0','react-native':'0.88.1'}}));
  const run=()=>cp.spawnSync(process.execPath,[path.join(root,'scripts/check-parity-source.mjs')],{encoding:'utf8'});
  assert.equal(run().status,0);assert.equal(run().status,0);
  fs.writeFileSync(path.join(root,'source.ts'),'drift');assert.match(run().stderr,/SOURCE_DRIFT: source.ts/);
  fs.unlinkSync(path.join(root,'source.ts'));assert.match(run().stderr,/SOURCE_DRIFT: source.ts/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

function toolsFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'connect-sdk-tools-'));
 const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 const tools={compileSdk:'37',sdkPlatform:'platforms;android-37.0',buildTools:'37.0.0',ndk:'27.1.12297006'};
 write('scripts/check-parity-source.mjs',fs.readFileSync('scripts/check-parity-source.mjs'));
 write('PARITY_SOURCE_LOCK.json',JSON.stringify({pwaSha:'reference',files:{},androidTools:tools}));
 write('app.json',fs.readFileSync('app.json'));
 write('package.json',fs.readFileSync('package.json'));
 write('node_modules/react-native/gradle/libs.versions.toml','compileSdk = "37"\nbuildTools = "37.0.0"\nndkVersion = "27.1.12297006"\n');
 write('android/gradle/wrapper/gradle-wrapper.properties','distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip\n');
 const run=()=>cp.spawnSync(process.execPath,['scripts/check-parity-source.mjs','--tools'],{cwd:root,encoding:'utf8'});
 return {root,tools,write,run,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('API 37 resolves to the actual SDK package android-37.0 and tool drift is rejected',()=>{
 const f=toolsFixture();
 try{
  for(let i=0;i<2;i++){
   const result=f.run();assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),f.tools);
  }
  f.write('node_modules/react-native/gradle/libs.versions.toml','compileSdk = "38"\nbuildTools = "37.0.0"\nndkVersion = "27.1.12297006"\n');
  assert.match(f.run().stderr,/SOURCE_DRIFT:/);
  f.write('node_modules/react-native/gradle/libs.versions.toml','compileSdk = "37"\nbuildTools = "37.0.0"\nndkVersion = "27.1.12297006"\n');
  f.write('PARITY_SOURCE_LOCK.json',JSON.stringify({pwaSha:'reference',files:{},androidTools:{...f.tools,sdkPlatform:'platforms;android-37'}}));
  assert.match(f.run().stderr,/SOURCE_DRIFT:/);
 }finally{f.cleanup();}
});

test('the final workflow SDK step requests the verified package instead of an unavailable API alias',()=>{
 const f=toolsFixture();
 try{
  const yaml=require('js-yaml');
  const workflow=yaml.load(fs.readFileSync('../.github/workflows/connect-android-parity-notifications-final.yml','utf8'));
  const step=workflow.jobs.verify.steps.find(s=>s.name==='Generate native project and derive SDK from installed Gradle sources');
  assert.ok(step,'SDK step must exist');
  f.write('verification/parity/.keep','');
  f.write('bin/npx','#!/bin/bash\nset -euo pipefail\ntest "$*" = "--no-install expo prebuild --platform android --no-install --clean"\n');
  f.write('bin/sdkmanager',`#!${process.execPath}\nconst assert=require('node:assert/strict');\nassert.deepEqual(process.argv.slice(2),['--channel=3','platforms;android-37.0','build-tools;37.0.0','ndk;27.1.12297006','cmake;3.22.1','platform-tools']);\nrequire('node:fs').writeFileSync('sdk-request-verified','ok');\n`);
  for(const name of ['npx','sdkmanager'])fs.chmodSync(path.join(f.root,'bin',name),0o755);
  const result=cp.spawnSync('/bin/bash',['-e','-o','pipefail','-c',step.run],{cwd:f.root,encoding:'utf8',env:{...process.env,PATH:path.join(f.root,'bin')+path.delimiter+process.env.PATH}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(f.root,'sdk-request-verified'),'utf8'),'ok');
 }finally{f.cleanup();}
});
