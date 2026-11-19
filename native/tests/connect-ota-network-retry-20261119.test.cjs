const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {isTransientOtaFailure,downloadOtaWithNetworkRetry}=require('../src/ConnectOtaNetwork.ts');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Wi-Fi Expo CDN timeout is retryable, but signature or compatibility errors are not',()=>{
  assert.equal(isTransientOtaFailure(Error("Failed to download asset from URL https://assets.eascdn.net/foo: timeout")),true);
  assert.equal(isTransientOtaFailure(Error('Unable to resolve host assets.eascdn.net')),true);
  assert.equal(isTransientOtaFailure(Error('HTTP 503')),true);
  for(const msg of ['certificate mismatch','signature failed','asset hash mismatch','Unauthorized HTTP 401','incompatible runtime'])
    assert.equal(isTransientOtaFailure(Error(msg)),false,msg);
});

test('transient Expo failures retry at most twice, then succeed without fake progress',async()=>{
  const calls=[], notices=[], waits=[];
  const result=await downloadOtaWithNetworkRetry(async()=>{
    calls.push(1);
    if(calls.length<3)throw Error('Failed to download asset: timeout');
    return {isNew:true};
  },n=>notices.push(n),async n=>{waits.push(n);});
  assert.equal(result.isNew,true);assert.equal(calls.length,3);
  assert.deepEqual(waits,[2500,6500]);
  assert.deepEqual(notices.map(x=>x.attempt),[2,3]);
  assert.ok(notices.every(x=>x.maxAttempts===3));
});

test('persistent Wi-Fi timeout fails cleanly after three attempts, not forever',async()=>{
  let attempts=0;
  await assert.rejects(()=>downloadOtaWithNetworkRetry(async()=>{
    attempts++;throw Error('timeout');
  },()=>{},async()=>{}),/timeout/);
  assert.equal(attempts,3);
});

test('an integrity error is never retried',async()=>{
  let attempts=0;
  await assert.rejects(()=>downloadOtaWithNetworkRetry(async()=>{
    attempts++;throw Error('signature mismatch');
  },()=>{throw Error('should never retry');},async()=>{}),/signature/);
  assert.equal(attempts,1);
});

test('OTA bridge allows sufficient timeout for retry, user sees attempts and safe fallback',()=>{
  assert.match(read('web/hybrid/runtime.ts'),/command==='updates:download'\?240000/);
  assert.match(read('web/hybrid/runtime.ts'),/if\(type==='ota-retry'\)/);
  assert.match(read('src/App.tsx'),/downloadOtaWithNetworkRetry/);
  assert.match(read('src/App.tsx'),/send\('ota-retry',notice\)/);
  assert.match(read('web/components/ConnectOtaSettings.tsx'),/Повторяем загрузку OTA — попытка/);
  assert.match(read('src/App.tsx'),/Три попытки не помогли/);
  assert.doesNotMatch(read('web/components/ConnectOtaSettings.tsx'),/EXPO_TOKEN|SERVICE_ROLE_KEY/);
});

test('new and modified files are included in PARITY_SOURCE_LOCK',()=>{
  const lock=JSON.parse(read('PARITY_SOURCE_LOCK.json'));
  for(const p of ['src/ConnectOtaNetwork.ts','src/App.tsx','web/hybrid/runtime.ts',
                   'web/components/ConnectOtaSettings.tsx','tests/connect-ota-network-retry-20261119.test.cjs']){
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
    assert.equal(lock.files[p],actual,p);
  }
});
