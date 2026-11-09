const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const vm=require('node:vm');
const ts=require('typescript');
const {registerPackage}=require('../plugins/withConnectWaveform');

test('waveform package registers once in the installed Expo Kotlin template and rejects drift',()=>{
  // Read the official installed tarball without spawning shell processes.
  const archive=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../node_modules/expo/template.tgz')));
  let template='';
  for(let offset=0;offset+512<=archive.length;){
    const name=archive.subarray(offset,offset+100).toString().replace(/\0.*$/s,'');
    const size=parseInt(archive.subarray(offset+124,offset+136).toString().replace(/\0.*$/s,'').trim(),8)||0;
    if(name.endsWith('/MainApplication.kt'))template=archive.subarray(offset+512,offset+512+size).toString();
    offset+=512+Math.ceil(size/512)*512;
  }
  assert.ok(template,'Installed Expo template must contain MainApplication.kt');
  const patched=registerPackage(template,'kt');
  assert.match(patched,/add\(com\.connect\.waveform\.ConnectWaveformPackage\(\)\)/);
  assert.equal(registerPackage(patched,'kt'),patched);
  assert.throws(()=>registerPackage('unexpected template','kt'),/unsupported/);
  const java='List<ReactPackage> packages = new PackageList(this).getPackages();';
  assert.match(registerPackage(java,'java'),/packages.add\(new com.connect.waveform.ConnectWaveformPackage\(\)\);/);
});

function harness(options={}){
  const calls={decodes:[],downloads:[],deleted:[],cancelled:0};
  const filesystem={
    cacheDirectory:'file:///cache/',
    async getInfoAsync(){return {exists:true,isDirectory:false,size:options.fileSize||100};},
    async deleteAsync(uri){calls.deleted.push(uri);},
    createDownloadResumable(remote,local,config,onProgress){
      calls.downloads.push({remote,local});
      return {
        async downloadAsync(){
          if(options.progress)onProgress(options.progress);
          if(options.downloadError)throw new Error('network failed');
          return {status:options.status||200,uri:local};
        },
        async cancelAsync(){calls.cancelled++;},
      };
    },
  };
  const native={async decode(uri,count){
    calls.decodes.push({uri,count});
    if(options.decode)return options.decode(uri,count);
    if(options.decodeError)throw new Error('unsupported codec');
    return Array(count).fill(.5);
  }};
  const output={};
  const source=fs.readFileSync(path.join(__dirname,'../src/nativeWaveform.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText,{exports:output,require(name){
    if(name==='react-native')return {Platform:{OS:options.platform||'android'},NativeModules:options.noNative?{}:{ConnectWaveform:native}};
    if(name==='expo-file-system/legacy')return filesystem;
    throw new Error(name);
  },setTimeout,clearTimeout,Date,Math,Promise,Map,Error});
  return {get:output.getAudioWaveform,calls};
}

test('full waveform decoding deduplicates concurrent work and returns independent cached arrays',async()=>{
  const h=harness();
  const [first,second]=await Promise.all([h.get('file:///voice.m4a',43),h.get('file:///voice.m4a',43)]);
  assert.equal(h.calls.decodes.length,1);
  first[0]=0;
  assert.equal(second[0],.5);
  assert.equal((await h.get('file:///voice.m4a',43))[0],.5);
  assert.equal(h.calls.decodes.length,1);
  assert.equal(h.calls.downloads.length,0);
});

test('downloaded private audio is removed on success and unsupported codec failures',async()=>{
  const success=harness();
  await success.get('https://connect.example/signed-private-audio');
  assert.equal(success.calls.downloads.length,1);
  assert.match(success.calls.decodes[0].uri,/^file:\/\/\/cache\//);
  assert.deepEqual(success.calls.deleted,[success.calls.downloads[0].local]);
  const failed=harness({decodeError:true});
  await assert.rejects(failed.get('https://connect.example/audio'),/unsupported codec/);
  assert.equal(failed.calls.deleted.length,1);
  assert.equal(failed.calls.cancelled,1);
});

test('oversized downloads cancel and clean up before reaching the decoder',async()=>{
  const h=harness({progress:{totalBytesWritten:1,totalBytesExpectedToWrite:129*1024*1024}});
  await assert.rejects(h.get('https://connect.example/large'),/128/);
  assert.equal(h.calls.decodes.length,0);
  assert.equal(h.calls.deleted.length,1);
  assert.ok(h.calls.cancelled>=1);
  const local=harness({fileSize:129*1024*1024});
  await assert.rejects(local.get('file:///large.m4a'),/128/);
  assert.equal(local.calls.decodes.length,0);
});

test('malformed decoder output is rejected and failures never populate the cache',async()=>{
  const h=harness({decode:()=>[NaN]});
  await assert.rejects(h.get('file:///broken.m4a',1),/неверную волну/);
  await assert.rejects(h.get('file:///broken.m4a',1),/неверную волну/);
  assert.equal(h.calls.decodes.length,2);
  const absent=harness({noNative:true});
  await assert.rejects(absent.get('file:///voice.m4a'),/недоступна/);
});

test('queued visible rows complete while only two decode jobs run at once',async()=>{
  let concurrent=0,maxConcurrent=0;
  const h=harness({async decode(uri,count){
    concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
    await new Promise(resolve=>setTimeout(resolve,1));
    concurrent--;
    return Array(count).fill(.25);
  }});
  const results=await Promise.all(Array.from({length:8},(_,i)=>h.get(`file:///voice-${i}.m4a`,3)));
  assert.equal(results.length,8);
  assert.equal(h.calls.decodes.length,8);
  assert.equal(maxConcurrent,2);
});
