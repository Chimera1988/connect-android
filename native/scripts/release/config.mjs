import {readFileSync,existsSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
export const read=name=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
export const app=read('app.json').expo;
export const CERT='a6507c8b798b77774144502fb1d9a6d09c53da98946b174c692175a96c230130';
export function requireConfig(){
 const p=read('package.json'),e=app;
 if(e.android.package!=='com.connect.messenger'||e.extra.eas.projectId!=='430c7f08-3921-48d5-96d1-f7c3d686d3bf'||
 e.updates.url!=='https://u.expo.dev/'+e.extra.eas.projectId||e.updates.requestHeaders['expo-channel-name']!=='production'||
 !e.updates.enabled||e.updates.checkAutomatically!=='ON_LOAD'||e.updates.fallbackToCacheTimeout!==0||
 typeof e.runtimeVersion!=='string'||!/^connect-android-ota-v\d+-sdk58$/.test(e.runtimeVersion)||
 !Number.isSafeInteger(e.android.versionCode)||e.android.versionCode<=25||e.version!==p.version||p.dependencies['expo-updates']!=='58.0.22')
 throw Error('Invalid production configuration / release identity');
 const properties=e.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-build-properties')?.[1].android;
 if(properties?.minSdkVersion!==29)throw Error('Android 10 minimum required');
 for(const name of ['package-lock.json','google-services.json','index.js','scripts/check_release_signing.py','scripts/verify-apk.py'])
 if(!existsSync(resolve(root,name)))throw Error('Missing '+name);
}
export function nativeBaseline(){
 requireConfig();
 const files=[];
 const walk=name=>{const path=resolve(root,name);if(statSync(path).isDirectory())for(const child of readdirSync(path).sort())walk(name+'/'+child);else files.push(name);};
 for(const name of ['plugins','assets','web/public','google-services.json'])walk(name);
 const nativeConfig=structuredClone(app);delete nativeConfig.version;delete nativeConfig.android.versionCode;
 // Every lock entry is covered, including transitive native dependencies. This
 // deliberately rejects some harmless dependency changes rather than risking an ABI mismatch.
 const lock=read('package-lock.json');delete lock.version;delete lock.packages[''].version;
 const digest=createHash('sha256').update(JSON.stringify(nativeConfig)).update(JSON.stringify(lock));
 for(const name of files.sort())digest.update(name+'\0').update(readFileSync(resolve(root,name)));
 return {schema:1,packageName:app.android.package,version:app.version,versionCode:app.android.versionCode,
 runtime:app.runtimeVersion,projectId:app.extra.eas.projectId,channel:'production',certificateSha256:CERT,nativeSha256:digest.digest('hex')};
}
export function writeReport(name,value){mkdirSync(resolve(root,'verification/parity'),{recursive:true});writeFileSync(resolve(root,'verification/parity',name),JSON.stringify(value,null,2)+'\n');}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 requireConfig();const baseline=nativeBaseline();writeReport('CONNECT-NATIVE-BASELINE.json',baseline);console.log(JSON.stringify(baseline,null,2));
}
