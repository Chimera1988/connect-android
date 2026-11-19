const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('APK update checks use Android PackageManager identity, never the OTA manifest version',async()=>{
 assert(fs.existsSync('src/installedAppIdentity.ts'),'installed identity helper missing');
 const js=ts.transpileModule(fs.readFileSync('src/installedAppIdentity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};Function('exports',js)(exports);
 const actual=await exports.readInstalledAppIdentity({getAppIdentity:async()=>({packageName:'com.connect.messenger',version:'3.0.7',build:25})});assert.equal(actual.build,25);
 await assert.rejects(()=>exports.readInstalledAppIdentity({}),/APK/);
 await assert.rejects(()=>exports.readInstalledAppIdentity({getAppIdentity:async()=>({packageName:'other',version:'3.0.8',build:26})}),/identity/);
 const app=fs.readFileSync('src/App.tsx','utf8');assert.doesNotMatch(app,/Constants\.expoConfig/);
 const native=fs.readFileSync('plugins/telecom/ConnectIncomingCallModule.kt','utf8');assert.match(native,/fun getAppIdentity/);assert.match(native,/longVersionCode/);
});
