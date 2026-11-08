/** Original Connect notification tones. Native Android channels require res/raw audio. */
const {withDangerousMod}=require('expo/config-plugins');
const fs=require('fs');
const path=require('path');
module.exports=function withConnectBuiltinSounds(config){
  return withDangerousMod(config,['android',async mod=>{
    const root=mod.modRequest.projectRoot;
    const dest=path.join(mod.modRequest.platformProjectRoot,'app','src','main','res','raw');
    fs.mkdirSync(dest,{recursive:true});
    for(const name of ['soft','bright','gentle']){
      const filename=`connect_${name}.wav`;
      const src=path.join(root,'assets','notification_sounds',filename);
      if(!fs.existsSync(src))throw Error('Missing notification sound: '+src);
      fs.copyFileSync(src,path.join(dest,filename));
    }
    return mod;
  }]);
};
