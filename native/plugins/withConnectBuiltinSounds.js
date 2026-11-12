/** Exact original Connect MP3 plus retained manually selectable legacy WAVs. */
const {withDangerousMod,withAppBuildGradle}=require('expo/config-plugins');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const MP3={
 'connect_ringtone.mp3':{bytes:481171,sha256:'974d3a6817676687c04fbce6568b238e31d8a30206fc0e5fe35cfbee9bf6025c'},
 'connect_notification.mp3':{bytes:28103,sha256:'8bf5b905ca973d7f38d84feaa4237d2246b10f5e186fb280f14781c05d70622e'},
};
function verify(root){
 for(const [name,expected] of Object.entries(MP3)){
  const data=fs.readFileSync(path.join(root,'assets/notification_sounds',name));
  if(data.length!==expected.bytes||crypto.createHash('sha256').update(data).digest('hex')!==expected.sha256)throw Error('Unexpected original Connect sound: '+name);
 }
 return MP3;
}
function copySounds(root,android){
 verify(root);const dest=path.join(android,'app/src/main/res/raw');fs.mkdirSync(dest,{recursive:true});
 for(const filename of [...['soft','bright','gentle','call'].map(n=>'connect_'+n+'.wav'),...Object.keys(MP3)])fs.copyFileSync(path.join(root,'assets/notification_sounds',filename),path.join(dest,filename));
 // --stable-ids is required: public XML declarations alone are ignored by
 // the final application link in the current Android Gradle plugin.
 fs.rmSync(path.join(android,'app/src/main/res/values/connect_sound_ids.xml'),{force:true});
 const names=['connect_bright','connect_call','connect_gentle','connect_soft','firebase_common_keep','keep','node_modules_expo_vectoricons_build_vendor_reactnativevectoricons_fonts_ionicons','connect_notification','connect_ringtone'];
 fs.writeFileSync(path.join(android,'app/connect-sound-ids.txt'),names.map((n,i)=>`com.connect.messenger:raw/${n} = 0x${(0x7f110000+i).toString(16)}`).join('\n')+'\n');
}
function configureBuild(source){
 if(source.includes('// connect-default-sounds-stable-ids'))return source;
 const anchor=/androidResources\s*\{/;
 if(!anchor.test(source))throw Error('Connect builtin sounds: Android resource configuration anchor missing');
 return source.replace(anchor,m=>m+'\n        // connect-default-sounds-stable-ids\n        additionalParameters += ["--stable-ids", file("connect-sound-ids.txt").absolutePath]');
}

module.exports=function withConnectBuiltinSounds(config){
 config=withAppBuildGradle(config,mod=>{mod.modResults.contents=configureBuild(mod.modResults.contents);return mod;});
 return withDangerousMod(config,['android',async mod=>{copySounds(mod.modRequest.projectRoot,mod.modRequest.platformProjectRoot);return mod;}]);
};
module.exports.verify=verify;module.exports.copySounds=copySounds;module.exports.configureBuild=configureBuild;
