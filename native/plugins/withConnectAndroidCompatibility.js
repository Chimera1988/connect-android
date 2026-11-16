/** Preserve the Expo splash on Android10; scope API33-only resources correctly. */
const {withAndroidStyles,withAndroidManifest,XML}=require('expo/config-plugins');
const path=require('node:path');
const API_ITEM='android:windowSplashScreenBehavior';
function splitSplashStyles(styles){
 const base=structuredClone(styles);
 const matches=(base.resources?.style||[]).filter(s=>s.$?.name==='Theme.App.SplashScreen');
 if(matches.length!==1)throw Error('SOURCE_DRIFT: expected one Expo splash style');
 const splash=matches[0];
 if(splash.$.parent!=='Theme.SplashScreen'||!splash.item?.some(i=>i.$?.name==='postSplashScreenTheme')||!splash.item?.some(i=>i.$?.name==='windowSplashScreenBackground'))throw Error('SOURCE_DRIFT: Expo splash mod must run before compatibility mod');
 const items=(splash.item||[]).filter(i=>i.$?.name===API_ITEM);
 if(items.length>1||items.some(i=>i._!=='icon_preferred'))throw Error('SOURCE_DRIFT: unknown splash behavior');
 splash.item=(splash.item||[]).filter(i=>i.$?.name!==API_ITEM);
 const modern=structuredClone(splash);modern.item.push({$:{name:API_ITEM},_:'icon_preferred'});
 return {base,v33:{resources:{style:[modern]}}};
}
function configureFeatures(manifest){
 const features=manifest['uses-feature']||[];
 for(const name of ['android.hardware.camera','android.hardware.camera.autofocus']){
  const found=features.filter(x=>x.$?.['android:name']===name);
  if(found.length>1)throw Error('SOURCE_DRIFT: duplicate camera feature');
  if(found.length)found[0].$['android:required']='false';
  else features.push({$:{'android:name':name,'android:required':'false'}});
 }
 manifest['uses-feature']=features;return manifest;
}
module.exports=config=>{
 config=withAndroidStyles(config,async mod=>{
  const result=splitSplashStyles(mod.modResults);mod.modResults=result.base;
  await XML.writeXMLAsync({path:path.join(mod.modRequest.platformProjectRoot,'app/src/main/res/values-v33/styles.xml'),xml:result.v33});return mod;
 });
 return withAndroidManifest(config,mod=>{configureFeatures(mod.modResults.manifest);return mod;});
};
module.exports.splitSplashStyles=splitSplashStyles;module.exports.configureFeatures=configureFeatures;
