/** Expo prebuild plugin for importing user-chosen audio into Android MediaStore.
 * The generated files belong to native/ android only. Legacy WebView app/ is untouched.
 */
const {withDangerousMod,withMainApplication}=require('expo/config-plugins');
const fs=require('fs');
const path=require('path');
const kotlinPackage='com.connect.messenger';
const kotlinModule=String.raw`package com.connect.messenger

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID

/** Copy a picked phone audio file to Android's persistent ringtone library.
 * The SYSTEM process needs a public MediaStore URI to play a notification.
 * Supported: Android 10+ with scoped storage (no storage permission needed).
 */
class ConnectSoundModule(private val ctx: ReactApplicationContext):ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "ConnectSoundModule"

  @ReactMethod
  fun importSound(sourceUri:String, originalName:String, kind:String, promise:Promise){
    Thread {
      var destination:Uri?=null
      try {
        if(Build.VERSION.SDK_INT<29)throw IllegalStateException("Для выбора своего звука нужен Android 10 или новее")
        if(kind!="calls"&&kind!="messages")throw IllegalArgumentException("Unknown sound category")
        val allowed=listOf("mp3","m4a","aac","ogg","wav")
        val ext=originalName.substringAfterLast('.',"").lowercase()
        if(ext !in allowed)throw IllegalArgumentException("Unsupported sound format")
        val mime=when(ext){
          "mp3"->"audio/mpeg"
          "m4a"->"audio/mp4"
          "aac"->"audio/aac"
          "ogg"->"audio/ogg"
          else->"audio/wav"
        }
        val resolver=ctx.contentResolver
        val uri=Uri.parse(sourceUri)
        if(uri.scheme!="content"&&uri.scheme!="file")throw IllegalArgumentException("Invalid audio URI")
        val input=resolver.openInputStream(uri)?:throw IllegalStateException("Cannot read selected file")
        val label=originalName.substringBeforeLast('.').replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(40)
        val filename="Connect_"+UUID.randomUUID().toString().take(8)+"_"+label+"."+ext
        val values=ContentValues().apply {
          put(MediaStore.Audio.Media.DISPLAY_NAME,filename)
          put(MediaStore.Audio.Media.MIME_TYPE,mime)
          put(MediaStore.Audio.Media.RELATIVE_PATH,if(kind=="calls")"Ringtones/Connect/" else "Notifications/Connect/")
          put(MediaStore.Audio.Media.IS_RINGTONE,if(kind=="calls")1 else 0)
          put(MediaStore.Audio.Media.IS_NOTIFICATION,if(kind=="messages")1 else 0)
          put(MediaStore.Audio.Media.IS_PENDING,1)
        }
        destination=resolver.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values)
          ?:throw IllegalStateException("Cannot create MediaStore audio")
        input.use{stream->
          val output=resolver.openOutputStream(destination!!,"w")?:throw IllegalStateException("Cannot write MediaStore audio")
          output.use{stream.copyTo(it)}
        }
        values.clear()
        values.put(MediaStore.Audio.Media.IS_PENDING,0)
        resolver.update(destination!!,values,null,null)
        promise.resolve(destination.toString())
      }catch(e:Exception){
        try{if(destination!=null)ctx.contentResolver.delete(destination!!,null,null)}catch(_:Exception){}
        promise.reject("CONNECT_AUDIO_IMPORT_FAILED",e.message,e)
      }
    }.start()
  }
}
`;
const kotlinBridge=String.raw`package com.connect.messenger

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ConnectSoundPackage:ReactPackage {
  override fun createNativeModules(context:ReactApplicationContext):List<NativeModule> = listOf(ConnectSoundModule(context))
  override fun createViewManagers(context:ReactApplicationContext):List<ViewManager<*,*>> = emptyList()
}
`;
module.exports=function withConnectSounds(config){
  config=withMainApplication(config,mod=>{
    if(mod.modResults.language==='java')throw new Error('Connect native sound integration requires Kotlin MainApplication');
    let src=mod.modResults.contents;
    if(src.includes('add(ConnectSoundPackage())'))return mod;
    const pattern=/PackageList\(this\)\.packages\.apply\s*\{/;
    if(!pattern.test(src))throw new Error('ConnectSounds: Expo MainApplication package registration anchor changed');
    src=src.replace(pattern,match=>match+'\n        add(ConnectSoundPackage())');
    mod.modResults.contents=src;
    return mod;
  });
  return withDangerousMod(config,['android',async mod=>{
    const pkg=path.join(mod.modRequest.platformProjectRoot,'app','src','main','java',...kotlinPackage.split('.'));
    fs.mkdirSync(pkg,{recursive:true});
    fs.writeFileSync(path.join(pkg,'ConnectSoundModule.kt'),kotlinModule);
    fs.writeFileSync(path.join(pkg,'ConnectSoundPackage.kt'),kotlinBridge);
    return mod;
  }]);
};
