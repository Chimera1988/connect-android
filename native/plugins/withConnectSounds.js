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
import com.facebook.react.bridge.LifecycleEventListener
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** Copy a picked phone audio file to Android's persistent ringtone library.
 * The SYSTEM process needs a public MediaStore URI to play a notification.
 * Supported: Android 10+ with scoped storage (no storage permission needed).
 */
internal object ConnectSoundResources {
  fun isLegacy(scheme:String?,authority:String?,path:String?,pkg:String,id:Int):Boolean =
    scheme=="android.resource"&&authority==pkg&&
      (path=="/raw/connect_soft"||(id!=0&&path=="/$id"))
}
class ConnectSoundModule(private val ctx: ReactApplicationContext):ReactContextBaseJavaModule(ctx),LifecycleEventListener {
  private val audioWorker=Executors.newSingleThreadExecutor()
  private val mainHandler=android.os.Handler(android.os.Looper.getMainLooper())
  init { ctx.addLifecycleEventListener(this) }
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
        if(uri.scheme=="file"){
          val source=File(uri.path?:throw IllegalArgumentException("Missing audio path")).canonicalFile
          val roots=listOf(ctx.cacheDir,ctx.filesDir).map { it.canonicalFile.path+File.separator }
          if(roots.none { source.path.startsWith(it) })throw IllegalArgumentException("Audio file must be selected with Android document picker")
        }
        val label=originalName.substringBeforeLast('.').replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(40)
        val filename="Connect_"+UUID.randomUUID().toString().take(8)+"_"+label+"."+ext
        val values=ContentValues().apply {
          put(MediaStore.Audio.Media.DISPLAY_NAME,filename)
          put(MediaStore.Audio.Media.MIME_TYPE,mime)
          put(MediaStore.Audio.Media.RELATIVE_PATH,if(kind=="calls")"Ringtones/Connect/" else "Notifications/Connect/")
          put(MediaStore.Audio.Media.IS_RINGTONE,if(kind=="calls")1 else 0)
          put(MediaStore.Audio.Media.IS_NOTIFICATION,if(kind=="messages")1 else 0)
          put(MediaStore.Audio.Media.IS_MUSIC,0)
          put(MediaStore.Audio.Media.IS_PENDING,1)
        }
        destination=resolver.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values)
          ?:throw IllegalStateException("Cannot create MediaStore audio")
        (resolver.openInputStream(uri)?:throw IllegalStateException("Cannot read selected file")).use{stream->
          val output=resolver.openOutputStream(destination!!,"w")?:throw IllegalStateException("Cannot write MediaStore audio")
          output.use{sink->
            val buffer=ByteArray(32768)
            var total=0L
            while(true){
              val count=stream.read(buffer)
              if(count<0)break
              total+=count
              if(total>20L*1024*1024)throw IllegalArgumentException("Мелодия должна быть не больше 20 МБ")
              sink.write(buffer,0,count)
            }
            if(total==0L)throw IllegalArgumentException("Выбран пустой аудиофайл")
          }
        }
        val metadata=android.media.MediaMetadataRetriever()
        try{
          metadata.setDataSource(ctx,destination!!)
          val duration=metadata.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?:0L
          if(duration<=0L)throw IllegalArgumentException("Android не может прочитать выбранный аудиофайл")
        }finally{metadata.release()}
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

  /** Preserve an Android-edited legacy channel sound while changing only the
   * factory resource. Resource IDs may be numeric or use raw/name. */
  @ReactMethod
  fun migratedMessageSound(id:String,promise:Promise){
    try{
      val manager=ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
      val channel=manager.getNotificationChannel(id)
      if(channel==null){promise.resolve("connect_notification");return}
      val uri=channel.sound
      if(uri==null){promise.resolve("");return}
      val legacy=ctx.resources.getIdentifier("connect_soft","raw",ctx.packageName)
      val factory=ConnectSoundResources.isLegacy(uri.scheme,uri.authority,uri.path,ctx.packageName,legacy)
      promise.resolve(if(factory)"connect_notification" else uri.toString())
    }catch(e:Exception){promise.reject("CONNECT_CHANNEL_MIGRATION_FAILED","Не удалось прочитать настройки канала сообщений",e)}
  }

  private val previewEpoch=AtomicInteger(0)
  @Volatile private var previewForeground=true
  private var previewPlayer:android.media.MediaPlayer?=null
  private fun releasePreview(){
    synchronized(this){
      previewPlayer?.setOnCompletionListener(null)
      previewPlayer?.release()
      previewPlayer=null
    }
  }
  @ReactMethod
  fun previewSound(source:String, promise:Promise){
    val epoch=previewEpoch.incrementAndGet()
    audioWorker.execute {
    try {
      synchronized(this){
        releasePreview()
        if(epoch!=previewEpoch.get()||!previewForeground){promise.resolve(false);return@execute}
        val location=when(source){
          "default-notification"->android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION)
          "default-ringtone"->android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)
          else->Uri.parse(source)
        } ?: throw IllegalStateException("Default sound is unavailable")
        if(location.scheme!="content"&&location.scheme!="android.resource")
          throw IllegalArgumentException("Only Android local audio can be previewed")
        val p=android.media.MediaPlayer()
        // Keep ownership before prepare: invalid/unsupported files must release
        // the newly allocated player too. Preparation never blocks Android UI.
        previewPlayer=p
        p.setAudioAttributes(android.media.AudioAttributes.Builder()
          .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
          .setUsage(android.media.AudioAttributes.USAGE_MEDIA).build())
        p.setDataSource(ctx,location)
        p.prepare()
        if(epoch!=previewEpoch.get()||!previewForeground){releasePreview();promise.resolve(false);return@execute}
        p.setOnCompletionListener { completed->
          synchronized(this){
            if(previewPlayer===completed)previewPlayer=null
            completed.release()
          }
        }
        p.start()
        mainHandler.postDelayed({
          synchronized(this){
            if(previewPlayer===p){
              previewPlayer=null
              p.setOnCompletionListener(null)
              p.stop()
              p.release()
            }
          }
        },60000)
      }
      promise.resolve(true)
    }catch(e:Exception){
      synchronized(this){previewPlayer?.release();previewPlayer=null}
      promise.reject("CONNECT_SOUND_PREVIEW_FAILED",e.message,e)
    }
    }
  }
  @ReactMethod
  fun stopPreviewSound(promise:Promise){
    previewEpoch.incrementAndGet()
    audioWorker.execute {
    try{
      releasePreview()
      promise.resolve(true)
    }catch(e:Exception){promise.reject("CONNECT_SOUND_STOP_FAILED",e.message,e)}
    }
  }
  private fun cancelPreview(){
    previewForeground=false
    previewEpoch.incrementAndGet()
    if(!audioWorker.isShutdown)audioWorker.execute { releasePreview() }
  }
  override fun onHostResume() { previewForeground=true }
  override fun onHostPause() { cancelPreview() }
  override fun onHostDestroy() { cancelPreview() }
  override fun invalidate(){
    previewForeground=false
    previewEpoch.incrementAndGet()
    ctx.removeLifecycleEventListener(this)
    mainHandler.removeCallbacksAndMessages(null)
    if(!audioWorker.isShutdown){audioWorker.execute { releasePreview() };audioWorker.shutdown()}
    super.invalidate()
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

module.exports.kotlinModule=kotlinModule;
