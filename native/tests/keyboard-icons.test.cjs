const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const keyboard=require('../plugins/withConnectKeyboard'),icons=require('../plugins/withConnectLauncherIcons'),telecom=require('../plugins/withConnectTelecom');
test('keyboard native patch owns one lifecycle listener and rejects incompatible upstream sources',()=>{
 const fixture='class RNCWebView { public RNCWebView(ThemedReactContext reactContext) {\n        super(reactContext);\n } public void destroy() { super.destroy(); } }';
 const result=keyboard.patch(fixture);assert.equal(keyboard.patch(result),result);assert.equal((result.match(/addOnGlobalLayoutListener\(connectKeyboardLayout\)/g)||[]).length,1);assert.equal((result.match(/removeOnGlobalLayoutListener\(connectKeyboardLayout\)/g)||[]).length,1);assert.throws(()=>keyboard.patch('class Different {}'),/changed/);
});
test('provided icons replace conflicting generated webp/xml only and are copied without edits',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'connect-icons-')),res=path.join(temp,'app/src/main/res');
 try{fs.mkdirSync(path.join(res,'mipmap-mdpi'),{recursive:true});fs.writeFileSync(path.join(res,'mipmap-mdpi/ic_launcher.webp'),'old');fs.writeFileSync(path.join(res,'mipmap-mdpi/other.png'),'keep');icons.copy(temp);icons.copy(temp);assert.equal(fs.existsSync(path.join(res,'mipmap-mdpi/ic_launcher.webp')),false);assert.equal(fs.readFileSync(path.join(res,'mipmap-mdpi/other.png'),'utf8'),'keep');
  const root=path.join(__dirname,'../plugins/launcher-icons');for(const folder of fs.readdirSync(root))for(const file of fs.readdirSync(path.join(root,folder)))assert.deepEqual(fs.readFileSync(path.join(root,folder,file)),fs.readFileSync(path.join(res,folder,file)));
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
test('one native call service and receiver replace older competing paths; messages delegate unchanged',()=>{
 const manifest={application:[{$:{},activity:[{$:{'android:name':'.MainActivity'}}]}]};telecom.configureManifest(manifest);const first=JSON.stringify(manifest);telecom.configureManifest(manifest);assert.equal(JSON.stringify(manifest),first);
 const app=manifest.application[0];assert.equal(app.service.filter(s=>s.$['android:name']==='.ConnectCallService').length,1);assert.equal(app.service.find(s=>s.$['android:name']==='.ConnectCallService').$['android:stopWithTask'],'false');assert.equal(app.service.find(s=>s.$['android:name']==='io.wazo.callkeep.VoiceConnectionService').$['tools:node'],'remove');assert.equal(app.receiver.find(s=>s.$['android:name']==='io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver').$['tools:node'],'remove');assert.equal(app.receiver.find(s=>s.$['android:name']==='.ConnectCallPushReceiver').$['android:permission'],'com.google.android.c2dm.permission.SEND');assert.equal(app.activity[0].$['android:windowSoftInputMode'],'adjustResize');
 const build=telecom.configureBuild('dependencies {\n}\n');assert.equal(telecom.configureBuild(build),build);assert.ok(build.includes('enableUnitTest = true'));
});
