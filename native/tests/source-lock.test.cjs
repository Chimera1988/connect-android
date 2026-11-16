const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
test('source lock is repeatable and rejects modified or missing reviewed sources',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'connect-source-lock-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));fs.copyFileSync('scripts/check-parity-source.mjs',path.join(root,'scripts/check-parity-source.mjs'));
  const text='reviewed';fs.writeFileSync(path.join(root,'source.ts'),text);
  fs.writeFileSync(path.join(root,'PARITY_SOURCE_LOCK.json'),JSON.stringify({pwaSha:'reference',files:{'source.ts':crypto.createHash('sha256').update(text).digest('hex')}}));
  fs.writeFileSync(path.join(root,'app.json'),JSON.stringify({expo:{version:'3.0.6',android:{package:'com.connect.messenger',versionCode:24},plugins:[['expo-build-properties',{android:{minSdkVersion:29}}]]}}));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{expo:'~58.0.0','react-native':'0.88.1'}}));
  const run=()=>cp.spawnSync(process.execPath,[path.join(root,'scripts/check-parity-source.mjs')],{encoding:'utf8'});
  assert.equal(run().status,0);assert.equal(run().status,0);
  fs.writeFileSync(path.join(root,'source.ts'),'drift');assert.match(run().stderr,/SOURCE_DRIFT: source.ts/);
  fs.unlinkSync(path.join(root,'source.ts'));assert.match(run().stderr,/SOURCE_DRIFT: source.ts/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
