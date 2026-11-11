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
 const service=read('ConnectCallService');assert.match(service,/CallStyle.forIncomingCall/);assert.match(service,/pending\(this, "decline", machine.id\)/);assert.match(service,/pending\(this, "answer", machine.id\)/);assert.match(service,/setContentIntent\(open\)/);assert.match(service,/setFullScreenIntent\(open,\s*true\)/);
 assert.match(read('ConnectCallScreen'),/setData\(Uri.parse\("connect:\/\/native-call\/\$id"\)\)/);
 assert.match(read('ConnectIncomingCallActivity'),/onWindowFocusChanged/);assert.match(read('ConnectIncomingCallActivity'),/STALE_INTENT/);
});
test('callback exceptions are staged and diagnostics never copy exception messages',()=>{
 const service=read('ConnectCallService');assert.doesNotMatch(service,/Не удалось открыть аудиоустройство/);assert.match(service,/failedOperation\(error,"native-callback","CALLBACK"\)/);
 const diag=read('ConnectCallDiagnostics');const exception=diag.slice(diag.indexOf('fun exception'),diag.indexOf('fun export'));
 assert.doesNotMatch(exception,/\.message|\.toString\(\)/);assert.match(exception,/javaClass.simpleName/);
 assert.match(service,/guardOwner=incoming&&!acceptedHere&&result !in listOf/);
});
test('bootstrap cannot consume the incoming notification entry or its first full-screen alert',()=>{
 const service=read('ConnectCallService');assert.match(service,/BOOTSTRAP_NOTIFICATION = 0x434f4f/);assert.match(service,/NOTIFICATION = 0x434f4e/);
 assert.match(service,/startForeground\(BOOTSTRAP_NOTIFICATION,notice/);assert.match(service,/startForeground\(NOTIFICATION,notification\(ringing\)/);
 assert.match(service,/incomingAlerts.canPresent\(machine.id\)/);assert.match(service,/FOREGROUND_SERVICE_IMMEDIATE/);
 assert.match(read('ConnectCallConnectionService'),/onShowIncomingCallUi\(\).*ConnectCallService.showIncomingUi\(id\)/);
 const focus=service.slice(service.indexOf('private fun applyFocus'),service.indexOf('private fun applyAudioState'));
 assert.doesNotMatch(focus,/stopSignals|stopIncoming/);assert.match(focus,/RINGING_FOCUS_INDEPENDENT/);
});
test('Android 15 call PendingIntent opts in only for explicit immutable native Activity',()=>{
 const screen=read('ConnectCallScreen');assert.match(screen,/Build.VERSION.SDK_INT>=35/);assert.match(screen,/setPendingIntentCreatorBackgroundActivityStartMode/);assert.match(screen,/FLAG_IMMUTABLE/);
 assert.match(screen,/ConnectIncomingCallActivity::class.java/);assert.doesNotMatch(screen,/getBroadcast|getService|\.send\(/);
});
test('MediaPlayer cannot silently replace custom URI with a system tone and reports fallback',()=>{
 const audio=read('ConnectCallAudio');assert.match(audio,/MediaPlayer\(\)/);assert.match(audio,/prepareAsync\(\)/);assert.doesNotMatch(audio,/RingtoneManager.getRingtone/);
 assert.match(audio,/URI_ACCESS_DENIED/);assert.match(audio,/FALLBACK_REQUESTED/);assert.match(audio,/ringWarning/);assert.match(audio,/generation!=token/);
 assert.match(audio,/VibrationAttributes.USAGE_RINGTONE/);assert.match(audio,/Build.VERSION.SDK_INT<=30\)systemSetting\("vibrate_when_ringing"\)/);
 assert.match(read('ConnectIncomingAlerts'),/CONNECT_VIBRATION_OFF/);assert.match(read('ConnectIncomingAlerts'),/SYSTEM_RING_VIBRATION_OFF/);
});
