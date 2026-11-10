const {withDangerousMod,withAndroidManifest}=require('expo/config-plugins');
const fs=require('fs'),path=require('path');
function copy(platform){
 const source=path.join(__dirname,'launcher-icons'),target=path.join(platform,'app/src/main/res');
 // Remove only generated resources with the same launcher names, including
 // Expo's .webp copies, which would otherwise duplicate the provided PNGs.
 for(const folder of fs.readdirSync(target))if(/^(drawable|mipmap)(-|$)/.test(folder)){
  const dir=path.join(target,folder);if(!fs.statSync(dir).isDirectory())continue;
  for(const name of fs.readdirSync(dir))if(/^ic_launcher(?:_round|_foreground|_background|_monochrome)?\.(?:png|webp|xml)$/.test(name))fs.rmSync(path.join(dir,name));
 }
 fs.cpSync(source,target,{recursive:true});
}
module.exports=function(config){
 config=withDangerousMod(config,['android',async mod=>{copy(mod.modRequest.platformProjectRoot);return mod;}]);
 return withAndroidManifest(config,mod=>{const app=mod.modResults.manifest.application[0];app.$['android:icon']='@mipmap/ic_launcher';app.$['android:roundIcon']='@mipmap/ic_launcher_round';return mod;});
};
module.exports.copy=copy;
