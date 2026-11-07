/** Re-created by Expo prebuild: native Android Telecom & lockscreen manifest. */
const {withAndroidManifest}=require('expo/config-plugins');
module.exports=function withConnectTelecom(config){
  return withAndroidManifest(config,config=>{
    const m=config.modResults.manifest;
    m['uses-permission']=m['uses-permission']||[];
    const desired=[
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.MANAGE_OWN_CALLS',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.WAKE_LOCK',
    ];
    for(const p of desired){
      if(!m['uses-permission'].some(x=>x.$?.['android:name']===p))m['uses-permission'].push({$:{'android:name':p}});
    }
    const app=m.application?.[0];
    if(!app)throw new Error('Connect Telecom plugin: no Android application');
    app.service=app.service||[];
    let service=app.service.find(x=>x.$?.['android:name']==='io.wazo.callkeep.VoiceConnectionService');
    if(!service){service={$:{'android:name':'io.wazo.callkeep.VoiceConnectionService'}};app.service.push(service);}
    service.$={...service.$,'android:permission':'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
      'android:exported':'true','android:foregroundServiceType':'phoneCall|microphone'};
    service['intent-filter']=[{action:[{$:{'android:name':'android.telecom.ConnectionService'}}]}];
    const activities=app.activity||[];
    const activity=activities.find(x=>/\.?MainActivity$/.test(x.$?.['android:name']||''));
    if(!activity)throw new Error('Connect Telecom plugin: MainActivity not found');
    activity.$['android:showWhenLocked']='true';
    activity.$['android:turnScreenOn']='true';
    return config;
  });
};
