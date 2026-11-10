package com.connect.messenger

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.util.Base64
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** User-selected SAF destinations; JavaScript receives opaque IDs, never URIs. */
class ConnectFilesModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  companion object {
    private const val REQUEST = 24731
    private const val MAX_BYTES = 100L * 1024 * 1024
    private const val MAX_CHUNK = 65536
    private const val MAX_BASE64 = ((MAX_CHUNK + 2) / 3) * 4
    private const val IDLE_MS = 120000L
  }
  private data class Save(val uri: Uri, val output: OutputStream, var size: Long = 0, var usedAt: Long = System.currentTimeMillis())
  private val saves = ConcurrentHashMap<String, Save>()
  private val worker = Executors.newSingleThreadExecutor()
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var destroyed = false
  private var picker: Promise? = null
  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST) return
      val promise = synchronized(this@ConnectFilesModule) { picker.also { picker = null } } ?: return
      if (resultCode != Activity.RESULT_OK) { promise.resolve(null); return }
      val uri = data?.data
      if (uri == null || uri.scheme != "content") { promise.reject("CONNECT_SAVE_URI", "Android не предоставил файл для сохранения"); return }
      execute(promise) {
        if (destroyed) throw IllegalStateException("Приложение закрыто")
        val stream = context.contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException("Не удалось открыть выбранный файл")
        val id = UUID.randomUUID().toString()
        saves[id] = Save(uri, stream)
        promise.resolve(id)
      }
    }
  }
  private val expire = object : Runnable {
    override fun run() {
      if (destroyed) return
      try { worker.execute {
        val now = System.currentTimeMillis()
        saves.entries.filter { now - it.value.usedAt > IDLE_MS }.forEach { closeSave(it.key, true) }
      } } catch (_: RejectedExecutionException) { }
      handler.postDelayed(this, 30000)
    }
  }
  init {
    context.addActivityEventListener(activityListener)
    context.addLifecycleEventListener(this)
    handler.postDelayed(expire, 30000)
  }
  override fun getName() = "ConnectFilesModule"
  private fun execute(promise: Promise, action: () -> Unit) {
    try { worker.execute {
      try { action() } catch (error: Exception) { promise.reject("CONNECT_SAVE_FAILED", error.message, error) }
    } } catch (error: RejectedExecutionException) { promise.reject("CONNECT_SAVE_CLOSED", "Сохранение уже закрыто", error) }
  }
  private fun closeSave(id: String, remove: Boolean) {
    val save = saves.remove(id) ?: return
    try { save.output.close() } catch (_: Exception) { }
    if (remove) try { DocumentsContract.deleteDocument(context.contentResolver, save.uri) } catch (_: Exception) { }
  }

  @ReactMethod
  fun startSave(name: String, mime: String, promise: Promise) {
    if (destroyed) { promise.reject("CONNECT_SAVE_CLOSED", "Приложение закрыто"); return }
    if (!mime.matches(Regex("[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+")) || mime.length > 120) {
      promise.reject("CONNECT_SAVE_TYPE", "Недопустимый тип файла"); return
    }
    synchronized(this) {
      if (picker != null || saves.size >= 2) { promise.reject("CONNECT_SAVE_BUSY", "Завершите предыдущее сохранение"); return }
      picker = promise
    }
    val safeName = name.replace(Regex("[\\\\/\\p{Cntrl}]"), "_").take(160).ifBlank { "Connect" }
    UiThreadUtil.runOnUiThread {
      val activity = context.currentActivity
      if (activity == null || activity.isFinishing || destroyed) {
        synchronized(this) { if (picker === promise) picker = null }
        promise.reject("CONNECT_SAVE_ACTIVITY", "Откройте Connect для выбора файла")
      } else try {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = mime
          putExtra(Intent.EXTRA_TITLE, safeName)
          addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        activity.startActivityForResult(intent, REQUEST)
      } catch (error: Exception) {
        synchronized(this) { if (picker === promise) picker = null }
        promise.reject("CONNECT_SAVE_PICKER", "Не удалось открыть выбор файла", error)
      }
    }
  }

  @ReactMethod
  fun writeSave(id: String, chunk: String, promise: Promise) = execute(promise) {
    val save = saves[id] ?: throw IllegalStateException("Сохранение уже завершено")
    try {
      if (chunk.length > MAX_BASE64 || chunk.length % 4 != 0 || !chunk.matches(Regex("[A-Za-z0-9+/]*={0,2}")))
        throw IllegalArgumentException("Недопустимый блок файла")
      val bytes = Base64.decode(chunk, Base64.NO_WRAP)
      if (bytes.isEmpty() || bytes.size > MAX_CHUNK || save.size + bytes.size > MAX_BYTES)
        throw IllegalArgumentException("Файл должен быть не больше 100 МБ")
      save.output.write(bytes)
      save.size += bytes.size
      save.usedAt = System.currentTimeMillis()
      promise.resolve(save.size.toDouble())
    } catch (error: Exception) { closeSave(id, true); throw error }
  }

  @ReactMethod
  fun finishSave(id: String, promise: Promise) = execute(promise) {
    val save = saves[id] ?: throw IllegalStateException("Сохранение уже завершено")
    try {
      save.output.flush()
      save.output.close()
      saves.remove(id)
      promise.resolve(save.size.toDouble())
    } catch (error: Exception) { closeSave(id, true); throw error }
  }

  @ReactMethod
  fun cancelSave(id: String, promise: Promise) = execute(promise) {
    closeSave(id, true)
    promise.resolve(true)
  }
  override fun onHostResume() { }
  override fun onHostPause() { /* The SAF picker itself pauses the host. */ }
  override fun onHostDestroy() { cleanup() }
  private fun cleanup() {
    val pending = synchronized(this) { picker.also { picker = null } }
    pending?.reject("CONNECT_SAVE_CLOSED", "Сохранение отменено при закрытии приложения")
    try { worker.execute { saves.keys.toList().forEach { closeSave(it, true) } } } catch (_: RejectedExecutionException) { }
  }
  override fun invalidate() {
    destroyed = true
    handler.removeCallbacksAndMessages(null)
    context.removeActivityEventListener(activityListener)
    context.removeLifecycleEventListener(this)
    cleanup()
    worker.shutdown()
    super.invalidate()
  }
}
