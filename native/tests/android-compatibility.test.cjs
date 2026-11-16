const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {splitSplashStyles,configureFeatures}=require('../plugins/withConnectAndroidCompatibility');
const style=()=>({resources:{style:[{$:{name:'Theme.App.SplashScreen',parent:'Theme.SplashScreen'},item:[{$:{name:'windowSplashScreenBackground'},_:'@color/splashscreen_background'},{$:{name:'postSplashScreenTheme'},_:'@style/AppTheme'},{$:{name:'android:windowSplashScreenBehavior'},_:'icon_preferred'}]}]}});
test('API33 splash behavior is scoped to values-v33 while Android10 retains original splash',()=>{
 const result=splitSplashStyles(style());
 assert(!JSON.stringify(result.base).includes('windowSplashScreenBehavior'));
 assert.equal(result.v33.resources.style[0].item.at(-1)._,'icon_preferred');
 assert.equal(result.v33.resources.style[0].item[0]._,'@color/splashscreen_background');
 assert.deepEqual(splitSplashStyles(result.base),result);
});
test('splash source drift never silently overwrites an unknown style',()=>{
 assert.throws(()=>splitSplashStyles({resources:{style:[]}}),/SOURCE_DRIFT/);
 const changed=style();changed.resources.style[0].item.at(-1)._='unknown';assert.throws(()=>splitSplashStyles(changed),/SOURCE_DRIFT/);
});
test('camera hardware is optional and repeated prebuild cannot duplicate feature declarations',()=>{
 const manifest={'uses-feature':[{$:{'android:name':'android.hardware.camera','android:required':'true'}}]};
 configureFeatures(manifest);const expected=JSON.stringify(manifest);configureFeatures(manifest);assert.equal(JSON.stringify(manifest),expected);
 assert.equal(manifest['uses-feature'].find(x=>x.$['android:name']==='android.hardware.camera').$['android:required'],'false');
});
test('Telecom permission rejection has an explicit failure path without suppressing lint',()=>{
 const source=fs.readFileSync('plugins/telecom/ConnectCallService.kt','utf8');
 const method=source.slice(source.indexOf('private fun telecom('),source.indexOf('private fun applyFocus('));
 assert.match(method,/catch \(error: SecurityException\)/);assert.match(method,/PERMISSION_DENIED/);assert.doesNotMatch(method,/SuppressLint/);
});
