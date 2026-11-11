const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=n=>fs.readFileSync(require.resolve('../plugins/telecom/'+n+'.kt'),'utf8');
test('Application owns restoration before React initialization',()=>{
 const plugin=fs.readFileSync(require.resolve('../plugins/withConnectTelecom'),'utf8');
 assert.match(plugin,/ConnectCallScreen.install\(this\)/);
 const screen=read('ConnectCallScreen');assert.doesNotMatch(screen,/import .*React|import .*WebView|hasActiveReactInstance|currentActivity/);assert.match(screen,/ACTION_USER_PRESENT/);assert.match(screen,/onActivityResumed/);
 assert.doesNotMatch(screen,/\.incoming\(|sounds\.|startForegroundService/);
});
test('Telecom is the only call focus owner and can resume native capture',()=>{
 assert.doesNotMatch(read('ConnectCallAudio'),/requestAudioFocus|abandonAudioFocus|manager.mode\s*=/);
 const telecom=read('ConnectCallConnectionService');assert.match(telecom,/onConnectionServiceFocusGained/);assert.match(telecom,/onConnectionServiceFocusLost/);assert.match(telecom,/connectionServiceFocusReleased/);
 const service=read('ConnectCallService');assert.match(service,/peer\?\.setAudioRecording\(available\)/);assert.match(service,/peer\?\.setAudioPlayout\(available\)/);assert.match(service,/ConnectCallConnectionService.answered\(machine.id\)/);
});
test('notification always retains stable native answer, decline and open actions',()=>{
 const service=read('ConnectCallService');assert.match(service,/CallStyle.forIncomingCall/);assert.match(service,/pending\(this, "decline", machine.id\)/);assert.match(service,/pending\(this, "answer", machine.id\)/);assert.match(service,/setContentIntent\(open\)/);assert.match(service,/setFullScreenIntent\(open, true\)/);
 assert.match(read('ConnectCallScreen'),/setData\(Uri.parse\("connect:\/\/native-call\/\$id"\)\)/);
 assert.match(read('ConnectIncomingCallActivity'),/onWindowFocusChanged/);assert.match(read('ConnectIncomingCallActivity'),/STALE_INTENT/);
});
test('callback exceptions are staged and diagnostics never copy exception messages',()=>{
 const service=read('ConnectCallService');assert.doesNotMatch(service,/Не удалось открыть аудиоустройство/);assert.match(service,/failedOperation\(error,"native-callback","CALLBACK"\)/);
 const diag=read('ConnectCallDiagnostics');const exception=diag.slice(diag.indexOf('fun exception'),diag.indexOf('fun export'));
 assert.doesNotMatch(exception,/\.message|\.toString\(\)/);assert.match(exception,/javaClass.simpleName/);
 assert.match(service,/guardOwner=incoming&&!acceptedHere&&result !in listOf/);
});
