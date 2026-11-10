const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function fixture(){
 const records=new Map(),played=[],channels=[];
 let vibration=true;
 const native={previewSound:async uri=>played.push(uri),stopPreviewSound:async()=>{},importSound:async()=> 'content://media/external/audio/media/17'};
 const secure={getItemAsync:async k=>records.get(k)||null,setItemAsync:async(k,v)=>records.set(k,v),deleteItemAsync:async k=>records.delete(k)};
 const deps={'react':{},'react-native':{Platform:{OS:'android'},NativeModules:{ConnectSoundModule:native,ConnectCallCoordinator:{getCallVibration:async()=>vibration,configureSounds:async(...args)=>{channels.push(args);return 'native-calls'}}}},'expo-document-picker':{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'content://provider/sound',name:'Моя мелодия.m4a',size:128}]})},'expo-secure-store':secure,'@notifee/react-native':{createChannel:async()=>{},AndroidImportance:{HIGH:4}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/ConnectNativeSoundSettings.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,{exports,require:n=>deps[n],Promise,Error});
 return{api:exports,records,played,channels,setVibration:v=>vibration=v};
}
test('Connect Call default preview is the embedded ringtone, never a system message tone',async()=>{
 const h=fixture();await h.api.previewConnectSound('calls');assert.deepEqual(h.played,['android.resource://com.connect.messenger/raw/connect_call']);
});
test('message vibration preference cannot turn off default call vibration',async()=>{
 const h=fixture();h.records.set('connect-native-notifications-v1',JSON.stringify({vibrate:false}));await h.api.getConnectSoundChannel('calls');assert.equal(h.channels[0][2],true);
 h.setVibration(false);await h.api.getConnectSoundChannel('calls');assert.equal(h.channels[1][2],false);
});
test('chosen call file survives settings reload; preview and reset use the same stored choice',async()=>{
 const h=fixture();await h.api.chooseConnectSound('calls');assert.equal((await h.api.getConnectSoundPreference('calls')).name,'Моя мелодия.m4a');
 await h.api.previewConnectSound('calls');assert.equal(h.played.at(-1),'content://media/external/audio/media/17');
 await h.api.setConnectSoundSilence('calls',true);await h.api.resetConnectSound('calls');assert.equal(await h.api.getConnectSoundSilence('calls'),false);assert.equal(await h.api.getConnectSoundPreference('calls'),null);
 await h.api.previewConnectSound('calls');assert.equal(h.played.at(-1),'android.resource://com.connect.messenger/raw/connect_call');
});
