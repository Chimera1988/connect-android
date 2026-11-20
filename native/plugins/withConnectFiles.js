const {withDangerousMod,withMainApplication}=require('expo/config-plugins');
const fs=require('fs');
const path=require('path');
module.exports=function withConnectFiles(config){
  config=withMainApplication(config,mod=>{
    const source=mod.modResults.contents;
    if(!source.includes('add(ConnectFilesPackage())')){
      const anchor=/PackageList\(this\)\.packages\.apply\s*\{/;
      if(!anchor.test(source))throw new Error('ConnectFiles: MainApplication registration anchor changed');
      mod.modResults.contents=source.replace(anchor,match=>match+'\n        add(ConnectFilesPackage())');
    }
    return mod;
  });
  return withDangerousMod(config,['android',async mod=>{
    const pkg=path.join(mod.modRequest.platformProjectRoot,'app','src','main','java','com','connect','messenger');
    fs.mkdirSync(pkg,{recursive:true});
    for(const file of ['ConnectFilesModule.kt','ConnectFilesPackage.kt'])
      fs.copyFileSync(path.join(__dirname,'files',file),path.join(pkg,file));
    const proguard=path.join(mod.modRequest.platformProjectRoot,'app','proguard-rules.pro');
    const rule='-keep class com.connect.messenger.ConnectFilesModule { public static android.webkit.WebResourceResponse interceptMedia(android.content.Context, android.webkit.WebResourceRequest); }';
    const rules=fs.readFileSync(proguard,'utf8');if(!rules.includes(rule))fs.writeFileSync(proguard,rules+'\n'+rule+'\n');
    return mod;
  }]);
};
