import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(resolve(root,'PARITY_SOURCE_LOCK.json'),'utf8'));
for(const [name,expected] of Object.entries(manifest.files)){
 const path=resolve(root,name);
 if(!existsSync(path)||createHash('sha256').update(readFileSync(path)).digest('hex')!==expected)throw Error('SOURCE_DRIFT: '+name);
}
const app=JSON.parse(readFileSync(resolve(root,'app.json'),'utf8')).expo;
if(app.android.package!=='com.connect.messenger'||app.version!=='3.0.7'||app.android.versionCode!==25)throw Error('SOURCE_DRIFT: release identity');
const props=app.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-build-properties')[1].android;
if(props.minSdkVersion!==29)throw Error('SOURCE_DRIFT: minSdk');
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
if(pkg.dependencies.expo!=='~58.0.0'||pkg.dependencies['react-native']!=='0.88.1')throw Error('SOURCE_DRIFT: Expo/RN');
if(process.argv.includes('--tools')){
 const toml=readFileSync(resolve(root,'node_modules/react-native/gradle/libs.versions.toml'),'utf8');
 const get=key=>{const m=toml.match(new RegExp('^'+key+' = "([^"\\n]+)"','m'));if(!m)throw Error('SOURCE_DRIFT: tool '+key);return m[1];};
 const compileSdk=get('compileSdk');
 // Gradle's API number is not the SDK Manager package ID. API 37 is published
 // as android-37.0 (also used by the successful 3.0.5 release workflow).
 const sdkPlatform=({'37':'platforms;android-37.0'})[compileSdk];
 if(!sdkPlatform)throw Error('SOURCE_DRIFT: unreviewed SDK platform for API '+compileSdk);
 const values={compileSdk,sdkPlatform,buildTools:get('buildTools'),ndk:get('ndkVersion')};
 if(JSON.stringify(values)!==JSON.stringify(manifest.androidTools))throw Error('SOURCE_DRIFT: Android build tools');
 const wrapper=readFileSync(resolve(root,'android/gradle/wrapper/gradle-wrapper.properties'),'utf8');
 if(!wrapper.includes('gradle-9.4.1-bin.zip'))throw Error('SOURCE_DRIFT: Gradle (requires reviewed Java 21)');
 console.log(JSON.stringify(values));
}else console.log('Verified '+Object.keys(manifest.files).length+' reviewed source hashes; PWA '+manifest.pwaSha);
