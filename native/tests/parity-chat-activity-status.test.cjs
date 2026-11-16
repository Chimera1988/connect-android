const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../web');
const file=fs.readFileSync(root+'/lib/chat-activity.ts','utf8');
const js=ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mexports={};vm.runInNewContext(js,{exports:mexports});
const {composerActivity,visiblePeerActivity,activityTtl}=mexports;

test('file chooser survives mobile app backgrounding but expires if abandoned',()=>{assert.equal(activityTtl('file'),60000);assert.equal(activityTtl('sticker'),8000);assert.equal(activityTtl(null),8000)});
test('idle composer does not claim activity',()=>assert.equal(composerActivity(false,false,false),null));
test('opening sticker picker announces sticker selection',()=>assert.equal(composerActivity(false,true,false),'sticker'));
test('opening file picker announces file selection',()=>assert.equal(composerActivity(false,false,true),'file'));
test('opening video camera without recording does not claim recording',()=>assert.equal(composerActivity(false,false,false),null));
test('video status starts only while recorder is active',()=>assert.equal(composerActivity(true,false,false),'video'));
test('recording has priority when another picker was previously open',()=>assert.equal(composerActivity(true,true,true),'video'));
test('sticker picker takes priority over a pending attachment dialog',()=>assert.equal(composerActivity(false,true,true),'sticker'));
test('cancelling or completing all actions removes the status',()=>assert.equal(composerActivity(false,false,false),null));
test('recipient sees a fresh activity in the same conversation',()=>assert.equal(visiblePeerActivity({chat:'one',kind:'file',until:9000},'one',1000),'file'));
test('recipient does not see a different chat activity',()=>assert.equal(visiblePeerActivity({chat:'one',kind:'sticker',until:9000},'two',1000),null));
test('recipient does not see a stale activity',()=>assert.equal(visiblePeerActivity({chat:'one',kind:'video',until:1000},'one',1000),null));
test('recipient rejects invalid activity kinds and invalid expiries',()=>{assert.equal(visiblePeerActivity({chat:'one',kind:'something',until:9000},'one',1000),null);assert.equal(visiblePeerActivity({chat:'one',kind:'file',until:NaN},'one',1000),null)});

test('actual PWA wires video, file and sticker status through the same activity channel',()=>{
 const page=fs.readFileSync(root+'/app/page.tsx','utf8');
 assert.match(page,/composerActivity\(videoNoteRecording,stickerPicker,filePickerOpen\)/);
 assert.match(page,/onRecordingChange=\{setVideoNoteRecording\}/);
 assert.match(page,/input\.addEventListener\('cancel',cancelFileSelection\)/);
 assert.match(page,/input\.removeEventListener\('cancel',cancelFileSelection\)/);
 assert.doesNotMatch(page,/<input ref=\{attachmentInput\}[^\n]*\bonCancel=/);
 assert.match(page,/const activePeerKind=visiblePeerActivity\(peerActivity,activeChat,Date\.now\(\)\)/);
 assert.match(page,/const updateTyping=useCallback/);
 assert.match(page,/const updateRecording=useCallback/);
});
test('native video events cannot advertise recording in a different chat',()=>{
 assert.equal(mexports.nativeVideoActivity(true,'old','new'),false);
 assert.equal(mexports.nativeVideoActivity(true,'same','same'),true);
 assert.equal(mexports.nativeVideoActivity(false,'same','same'),false);
 assert.equal(mexports.nativeVideoActivity(true,null,'same'),false);
});
