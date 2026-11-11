package com.connect.messenger

import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager

/** Permission ownership stays on the resumed call Activity, not a covered ReactActivity. */
internal object ConnectCallMicrophone {
  @Volatile var pending: Promise? = null
  @Synchronized fun fail(code:String,message:String){val callback=pending;pending=null;callback?.reject(code,message)}
  @Synchronized fun complete(granted: Boolean) {
    val callback=pending;pending=null
    if(granted)callback?.resolve(true) else callback?.reject("CALL_MICROPHONE","Для аудиозвонка разрешите доступ к микрофону.")
  }
}

/** Keeps the lock-screen surface independent of React, Expo and WebView startup. */
class ConnectIncomingCallModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "ConnectIncomingCallModule"

  @ReactMethod
  fun requestMicrophone(promise:Promise){
    context.runOnUiQueueThread{
      if(context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED){promise.resolve(true);return@runOnUiQueueThread}
      if(ConnectCallMicrophone.pending!=null){promise.reject("CALL_PERMISSION_BUSY","Запрос микрофона уже открыт.");return@runOnUiQueueThread}
      if(context.lifecycleState!=com.facebook.react.common.LifecycleState.RESUMED){promise.reject("CALL_WINDOW","Откройте Connect, чтобы разрешить микрофон");return@runOnUiQueueThread}
      ConnectCallMicrophone.pending=promise
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({if(ConnectCallMicrophone.pending===promise)ConnectCallMicrophone.fail("CALL_PERMISSION_TIMEOUT","Запрос доступа к микрофону не завершён за 25 секунд")},25000)
      try{context.startActivity(Intent(context,ConnectIncomingCallActivity::class.java)
        .putExtra("requestMic",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))}
      catch(_:Exception){ConnectCallMicrophone.complete(false)}
    }
  }

  @ReactMethod fun cancelMicrophone(promise:Promise){ConnectCallMicrophone.fail("CALL_CANCELLED","Подготовка звонка отменена");promise.resolve(true)}
  // AES-GCM key is generated inside Android Keystore and never exported.
  private val vaultWorker = java.util.concurrent.Executors.newSingleThreadExecutor()
  private fun vaultKey(): java.security.Key {
    val store=java.security.KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
    if(store.containsAlias("ConnectSecretsV1"))return store.getKey("ConnectSecretsV1",null)
    val generator=javax.crypto.KeyGenerator.getInstance("AES","AndroidKeyStore")
    generator.init(android.security.keystore.KeyGenParameterSpec.Builder("ConnectSecretsV1",
      android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(256).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE).build())
    return generator.generateKey()
  }
  @ReactMethod
  fun sealSecret(owner:String,name:String,value:String,opening:Boolean,promise:Promise) {
    if(!owner.matches(Regex("[0-9a-fA-F-]{36}"))||!name.matches(Regex("[A-Za-z0-9:_-]{1,180}"))||value.length>98304){promise.reject("VAULT_INPUT","Invalid secret record");return}
    vaultWorker.execute{try{
      val cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
      val aad=(owner+":"+name).toByteArray(Charsets.UTF_8)
      if(opening){
        val raw=android.util.Base64.decode(value,android.util.Base64.NO_WRAP)
        if(raw.size<29)throw java.lang.IllegalArgumentException("Invalid sealed record")
        cipher.init(javax.crypto.Cipher.DECRYPT_MODE,vaultKey(),javax.crypto.spec.GCMParameterSpec(128,raw.copyOfRange(0,12)))
        cipher.updateAAD(aad);promise.resolve(String(cipher.doFinal(raw.copyOfRange(12,raw.size)),Charsets.UTF_8))
      }else{
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE,vaultKey());cipher.updateAAD(aad)
        promise.resolve(android.util.Base64.encodeToString(cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8)),android.util.Base64.NO_WRAP))
      }
    }catch(error:Exception){promise.reject("VAULT_KEY","Secret record unavailable or authentication failed",error)}}
  }
  override fun invalidate(){ConnectCallMicrophone.complete(false);vaultWorker.shutdownNow();super.invalidate()}

  @ReactMethod
  fun setAppearance(scene:String,promise:Promise){
    if(scene in listOf("waves","aurora","moon","sunset","lagoon","nebula","minimal"))
      context.getSharedPreferences("connect_incoming",0).edit().putString("scene",scene).apply()
    promise.resolve(true)
  }

  @ReactMethod fun prepareCalls(once:Boolean,promise:Promise){
    context.runOnUiQueueThread{
      val prefs=context.getSharedPreferences("connect_call_settings",0)
      if(once&&prefs.getInt("setupVersion",0)>=17){promise.resolve(false);return@runOnUiQueueThread}
      val activity=context.currentActivity
      if(activity==null||!activity.hasWindowFocus()){promise.resolve(false);return@runOnUiQueueThread}
      activity.startActivity(Intent(activity,ConnectCallSetupActivity::class.java))
      promise.resolve(true)
    }
  }
  @ReactMethod
  fun openCallSettings(promise: Promise) {
    try {
      context.startActivity(Intent(context,ConnectCallSetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("CALL_SETTINGS", error.message, error) }
  }

  @ReactMethod
  fun canShowFullScreenCalls(promise: Promise) {
    val manager = context.getSystemService(android.app.NotificationManager::class.java)
    promise.resolve(android.os.Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())
  }


}

class ConnectIncomingCallPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ConnectIncomingCallModule(context), ConnectCallCoordinatorModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
