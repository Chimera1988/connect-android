/** Native-only audio calls; repeatable Expo plugin without a second call stack. */
const {withAndroidManifest,withDangerousMod,withMainApplication,withAppBuildGradle}=require('expo/config-plugins');
const fs=require('fs'),path=require('path');
function configureManifest(m){
 m.$=m.$||{};m.$['xmlns:tools']='http://schemas.android.com/tools';
 m['uses-permission']=m['uses-permission']||[];
 for(const permission of ['USE_FULL_SCREEN_INTENT','MANAGE_OWN_CALLS','FOREGROUND_SERVICE','FOREGROUND_SERVICE_PHONE_CALL','FOREGROUND_SERVICE_MICROPHONE','WAKE_LOCK','VIBRATE','RECEIVE_BOOT_COMPLETED']){
  const name='android.permission.'+permission;
  if(!m['uses-permission'].some(x=>x.$?.['android:name']===name))m['uses-permission'].push({$:{'android:name':name}});
 }
 const app=m.application?.[0];if(!app)throw Error('Connect call manifest: missing application');
 app.service=(app.service||[]).filter(s=>!['io.wazo.callkeep.VoiceConnectionService','.ConnectCallGuardService','.ConnectCallService','.ConnectCallConnectionService'].includes(s.$?.['android:name']));
 app.service.push({$:{'android:name':'io.wazo.callkeep.VoiceConnectionService','tools:node':'remove'}});
 app.service.push({$:{'android:name':'.ConnectCallService','android:exported':'false','android:foregroundServiceType':'phoneCall|microphone','android:stopWithTask':'false'}});
 app.service.push({$:{'android:name':'.ConnectCallConnectionService','android:permission':'android.permission.BIND_TELECOM_CONNECTION_SERVICE','android:exported':'true'},'intent-filter':[{action:[{$:{'android:name':'android.telecom.ConnectionService'}}]}]});
 app.service=app.service.filter(s=>!['io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService','.ConnectPushTokenService','.ConnectPushTokenJob'].includes(s.$?.['android:name']));
 app.service.push({$:{'android:name':'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService','tools:node':'remove'}});
 app.service.push({$:{'android:name':'.ConnectPushTokenService','android:exported':'false'},'intent-filter':[{action:[{$:{'android:name':'com.google.firebase.MESSAGING_EVENT'}}]}]});
 app.service.push({$:{'android:name':'.ConnectPushTokenJob','android:exported':'true','android:permission':'android.permission.BIND_JOB_SERVICE'}});
 app.receiver=(app.receiver||[]).filter(r=>!['io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver','.ConnectCallPushReceiver'].includes(r.$?.['android:name']));
 app.receiver.push({$:{'android:name':'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver','tools:node':'remove'}});
 app.receiver.push({$:{'android:name':'.ConnectCallPushReceiver','android:exported':'true','android:permission':'com.google.android.c2dm.permission.SEND'},'intent-filter':[{action:[{$:{'android:name':'com.google.android.c2dm.intent.RECEIVE'}}]}]});
 app.activity=app.activity||[];const main=app.activity.find(a=>/\.?MainActivity$/.test(a.$?.['android:name']||''));if(!main)throw Error('Connect call manifest: missing MainActivity');
 delete main.$['android:showWhenLocked'];delete main.$['android:turnScreenOn'];main.$['android:windowSoftInputMode']='adjustResize';
 if(!app.activity.some(a=>a.$?.['android:name']==='.ConnectIncomingCallActivity'))app.activity.push({$:{'android:name':'.ConnectIncomingCallActivity','android:exported':'false','android:theme':'@style/ConnectIncomingCallTheme','android:launchMode':'singleTask','android:excludeFromRecents':'true','android:showWhenLocked':'true','android:turnScreenOn':'true'}});
 app.service=(app.service||[]).filter(s=>s.$?.['android:name']!=='.ConnectCallHintJob');
 app.service.push({$:{'android:name':'.ConnectCallHintJob','android:exported':'true','android:permission':'android.permission.BIND_JOB_SERVICE'}});
 app.receiver=(app.receiver||[]).filter(r=>r.$?.['android:name']!=='.ConnectCallRestoreReceiver');
 app.receiver.push({$:{'android:name':'.ConnectCallRestoreReceiver','android:exported':'false'},'intent-filter':[{action:[{$:{'android:name':'android.intent.action.BOOT_COMPLETED'}},{$:{'android:name':'android.intent.action.MY_PACKAGE_REPLACED'}}]}]});
 if(!app.activity.some(a=>a.$?.['android:name']==='.ConnectCallSetupActivity'))app.activity.push({$:{'android:name':'.ConnectCallSetupActivity','android:exported':'false','android:theme':'@style/ConnectIncomingCallTheme'}});
 app.provider=(app.provider||[]).filter(p=>p.$?.['android:authorities']!=='${applicationId}.call-diagnostics');
 app.provider.push({$:{'android:name':'androidx.core.content.FileProvider','android:authorities':'${applicationId}.call-diagnostics','android:exported':'false','android:grantUriPermissions':'true'},'meta-data':[{$:{'android:name':'android.support.FILE_PROVIDER_PATHS','android:resource':'@xml/connect_call_diagnostics_paths'}}]});
 return m;
}
function writeNative(platform){
 const pkg=path.join(platform,'app/src/main/java/com/connect/messenger');fs.mkdirSync(pkg,{recursive:true});
 for(const file of fs.readdirSync(path.join(__dirname,'telecom')).filter(n=>n.endsWith('.kt')&&n!=='ConnectCallGuardService.kt'))fs.copyFileSync(path.join(__dirname,'telecom',file),path.join(pkg,file));
 fs.rmSync(path.join(pkg,'ConnectCallGuardService.kt'),{force:true});
 const tests=path.join(platform,'app/src/test/java/com/connect/messenger');fs.mkdirSync(tests,{recursive:true});
 for(const file of fs.readdirSync(path.join(__dirname,'telecom-tests')).filter(n=>n.endsWith('.kt')))fs.copyFileSync(path.join(__dirname,'telecom-tests',file),path.join(tests,file));
 const xml=path.join(platform,'app/src/main/res/xml');fs.mkdirSync(xml,{recursive:true});fs.writeFileSync(path.join(xml,'connect_call_diagnostics_paths.xml'),'<paths><cache-path name="diagnostics" path="connect-call-export/" /></paths>');
 const values=path.join(platform,'app/src/main/res/values');fs.mkdirSync(values,{recursive:true});
 fs.writeFileSync(path.join(values,'connect_incoming.xml'),`<resources>
<style name="ConnectIncomingCallTheme" parent="android:style/Theme.Material.NoActionBar">
<item name="android:windowBackground">#0a0e16</item><item name="android:windowDisablePreview">true</item><item name="android:windowIsTranslucent">true</item>
<item name="android:windowActionModeOverlay">true</item><item name="android:windowLightStatusBar">false</item><item name="android:windowLightNavigationBar">false</item>
</style></resources>`);
}
module.exports=function(config){
 config=withAppBuildGradle(config,mod=>{mod.modResults.contents=configureBuild(mod.modResults.contents);return mod;});
 config=withMainApplication(config,mod=>{let s=mod.modResults.contents;if(!s.includes('add(ConnectIncomingCallPackage())')){const anchor=/PackageList\(this\)\.packages\.apply\s*\{/;if(!anchor.test(s))throw Error('Connect package registration changed');s=s.replace(anchor,m=>m+'\n        add(ConnectIncomingCallPackage())');}mod.modResults.contents=s;return mod;});
 config=withDangerousMod(config,['android',async mod=>{writeNative(mod.modRequest.platformProjectRoot);return mod;}]);
 return withAndroidManifest(config,mod=>{configureManifest(mod.modResults.manifest);return mod;});
};
module.exports.configureManifest=configureManifest;module.exports.writeNative=writeNative;
function configureBuild(source){
 if(!source.includes('// Connect call core tests')){const anchor='dependencies {';if(!source.includes(anchor))throw Error('Connect test dependencies changed');source=source.replace(anchor,anchor+"\n    // Connect call core tests\n    testImplementation 'junit:junit:4.13.2'");}
 if(!source.includes('// Connect native FCM token delivery'))source=source.replace('dependencies {',"dependencies {\n    // Connect native FCM token delivery\n    implementation 'com.google.firebase:firebase-messaging:26.0.0'");
 if(!source.includes('// Connect release JVM verification'))source+="\n// Connect release JVM verification\nandroidComponents { beforeVariants(selector().withBuildType('release')) { variant -> variant.enableUnitTest = true } }\n";
 return source;
}
module.exports.configureBuild=configureBuild;
