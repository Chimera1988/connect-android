import {readFileSync,statSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {app,root,read,requireConfig,nativeBaseline,writeReport,CERT} from './config.mjs';
requireConfig();
const mode=process.argv[2]||'source';
if(mode==='source'){
 if(!existsSync(resolve(root,'src/generated/pwa.ts')))throw Error('Embedded UI missing: run build:web');
 const workflow=resolve(root,'../.github/workflows/connect-android-parity-release.yml');
 const bytes=statSync(workflow).size;if(bytes<=0||bytes>=450000)throw Error('Workflow must be 1..449999 bytes');
 const text=readFileSync(workflow,'utf8');if(/\|\|\s*true|base64 --decode.*>>|<<['"]?(PY|JS|EOF)/.test(text))throw Error('Embedded source or hidden workflow error');
 writeReport('workflow-size.json',{bytes,limit:450000});
 console.log('Release source/configuration verified; YAML bytes='+bytes);
}else if(mode==='export'){
 const folder=resolve(root,process.argv[3]||'verification/parity/export');
 const metadata=JSON.parse(readFileSync(resolve(folder,'metadata.json'),'utf8'));
 const bundle=resolve(folder,metadata.fileMetadata.android.bundle);
 if(!bundle.startsWith(folder+'/')||statSync(bundle).size<100000||readFileSync(bundle).subarray(0,8).toString('hex')!=='c61fbc03c103191f')throw Error('Valid Hermes bytecode required');
 writeReport('export-verified.json',{runtime:app.runtimeVersion,hermesBytes:statSync(bundle).size});
}else if(mode==='prebuild'){
 const xml=readFileSync(resolve(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 const strings=readFileSync(resolve(root,'android/app/src/main/res/values/strings.xml'),'utf8');
 for(const value of ['expo.modules.updates.EXPO_RUNTIME_VERSION',app.updates.url,'expo-channel-name','production','ConnectIncomingCallActivity','ConnectCallService','android.permission.FOREGROUND_SERVICE_PHONE_CALL','android.permission.FOREGROUND_SERVICE_MICROPHONE'])if(!xml.includes(value))throw Error('Missing manifest '+value);
 if(!strings.includes(app.runtimeVersion))throw Error('Wrong generated runtime');
 if(!existsSync(resolve(root,'android/app/src/main/assets/connect-web/stickers/speed/hello.webp')))throw Error('Native sticker assets missing');
 const gradle=readFileSync(resolve(root,'android/app/build.gradle'),'utf8');
 if(!gradle.includes('signingConfig connectKeystore ? signingConfigs.connectRelease : null'))throw Error('Debug release fallback forbidden');
 writeReport('prebuild-verified.json',{packageName:app.android.package,runtime:app.runtimeVersion});
}else if(mode==='ota'){
 const baseline=JSON.parse(readFileSync(process.argv[3],'utf8')),current=nativeBaseline();
 for(const field of ['schema','packageName','runtime','projectId','channel','nativeSha256','certificateSha256'])
 if(baseline[field]!==current[field])throw Error('OTA incompatible '+field+': install a new APK first');
 if(!/^[0-9a-f]{64}$/.test(baseline.apkSha256||'')||!Number.isSafeInteger(baseline.versionCode))throw Error('Baseline lacks a verified APK');
 writeReport('ota-compatibility.json',{compatible:true,baseline,current});
}else throw Error('Unknown validation '+mode);
