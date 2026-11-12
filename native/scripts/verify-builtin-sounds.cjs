const path=require('node:path');
const result=require('../plugins/withConnectBuiltinSounds').verify(path.resolve(__dirname,'..'));
console.log(JSON.stringify(result,null,2));
