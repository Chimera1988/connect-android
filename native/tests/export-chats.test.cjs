const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

// Execute the production handler. Only its platform services and database are mocked.
const source=fs.readFileSync(path.join(__dirname,'../src/ConnectNativeSettings.tsx'),'utf8');
const parsed=ts.createSourceFile('ConnectNativeSettings.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler;
function find(node){
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='exportChats')handler=node.getText(parsed);
  ts.forEachChild(node,find);
}
find(parsed);
assert.ok(handler,'Settings must expose its export handler');
const code=ts.transpile(handler,{target:ts.ScriptTarget.ES2022});

async function exportFixture(sizes){
  let exported;
  let summary='';
  const pages=[];
  const conversations=sizes.map((_,i)=>({id:String(i),created_at:'2026-11-09T00:00:00Z'}));
  const db={from(table){
    let conversationId;
    return {
      select(){return this;},or(){return this;},order(){return this;},
      eq(_,id){conversationId=id;return this;},
      limit(){assert.equal(table,'conversations');return Promise.resolve({data:conversations,error:null});},
      range(start,end){
        assert.equal(table,'messages');pages.push({conversationId,start,end});
        const length=Math.max(0,Math.min(sizes[Number(conversationId)]-start,end-start+1));
        return Promise.resolve({data:Array.from({length},(_,i)=>({id:`${conversationId}:${start+i}`})),error:null});
      },
    };
  }};
  const context=vm.createContext({db,owner:{id:'test-owner'},working:false,setWorking(){},setExportSummary(value){summary=value;},
    FileSystem:{documentDirectory:'file:///tmp/',EncodingType:{UTF8:'utf8'},async writeAsStringAsync(_,json){exported=JSON.parse(json);}},
    Sharing:{async isAvailableAsync(){return true;},async shareAsync(){}},errorOf:String,Date,Math,JSON,Error,
  });
  await vm.runInContext(code+'\nexportChats();',context);
  return {exported,pages,summary};
}

for(const [sizes,expected] of [[[],0],[[501],501],[[26000],26000],[[49750,1000],50000],[[60000],50000]]){
  test(`export ${JSON.stringify(sizes)} respects 50,000-message cap`,async()=>{
    const {exported,pages,summary}=await exportFixture(sizes);
    assert.ok(exported,'Handler must create JSON');
    assert.equal(exported.messages.length,expected);
    assert.equal(new Set(exported.messages.map(message=>message.id)).size,expected,'Every exported message must be unique');
    assert.equal(exported.conversations.length,sizes.length);
    assert.ok(pages.every(page=>page.end-page.start<500),'Requests must stay within 500-message pages');
    if(expected===50000)assert.match(summary,/ограничен 50 000/);
  });
}
