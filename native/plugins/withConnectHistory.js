const {withDangerousMod,withMainApplication,withAppBuildGradle}=require('expo/config-plugins');
const fs=require('fs'),path=require('path');
function copy(platform){
 const destination=path.join(platform,'app/src/main/java/com/connect/messenger');fs.mkdirSync(destination,{recursive:true});
 for(const name of fs.readdirSync(path.join(__dirname,'history')).filter(n=>n.endsWith('.kt')))fs.copyFileSync(path.join(__dirname,'history',name),path.join(destination,name));
 const tests=path.join(platform,'app/src/test/java/com/connect/messenger');fs.mkdirSync(tests,{recursive:true});
 const source=path.join(__dirname,'history-tests/HistoryStoreTest.kt');if(fs.existsSync(source))fs.copyFileSync(source,path.join(tests,'HistoryStoreTest.kt'));
}
function build(source){
 if(!source.includes('// Connect real SQLite JVM tests'))source=source.replace('dependencies {',"dependencies {\n    // Connect real SQLite JVM tests\n    testImplementation 'org.xerial:sqlite-jdbc:3.51.0.0'");
 return source;
}
module.exports=function(config){
 config=withMainApplication(config,mod=>{if(!mod.modResults.contents.includes('add(ConnectHistoryPackage())')){
  const anchor=/PackageList\(this\)\.packages\.apply\s*\{/;if(!anchor.test(mod.modResults.contents))throw Error('History package registration changed');
  mod.modResults.contents=mod.modResults.contents.replace(anchor,m=>m+'\n        add(ConnectHistoryPackage())');
 }return mod;});
 config=withAppBuildGradle(config,mod=>{mod.modResults.contents=build(mod.modResults.contents);return mod;});
 return withDangerousMod(config,['android',async mod=>{copy(mod.modRequest.platformProjectRoot);return mod;}]);
};
module.exports.copy=copy;module.exports.build=build;
