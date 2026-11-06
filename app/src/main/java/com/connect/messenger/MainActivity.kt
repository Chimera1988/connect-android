package com.connect.messenger

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.media.MediaPlayer
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

object ConnectAppPresence {
    @Volatile var visible = false
    @Volatile var activeConversation = ""
}

class MainActivity : Activity() {
    private lateinit var web: WebView
    private val site = "https://connect-chat.duckdns.org/"
    private val chooserCode = 1001
    private val mediaCode = 1002
    private val notificationCode = 1003
    private val soundCode = 1004
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var mediaRequest: PermissionRequest? = null
    private var mediaResources: Array<String> = emptyArray()
    private var selectedSoundKind: String? = null
    private var loadErrorVisible = false
    private var pageLoaded = false
    private var pendingCallAction: JSONObject? = null
    private var pendingChatId: String? = null
    private var previewPlayer: MediaPlayer? = null

    private fun validUuid(value: String): Boolean = Regex("[0-9a-fA-F-]{36}").matches(value)
    private fun validKind(value: String) = value == "message" || value == "call"

    private fun notifyWeb(event: String, data: JSONObject) {
        if (!pageLoaded || isFinishing || isDestroyed) return
        runOnUiThread {
            if (!pageLoaded || isFinishing || isDestroyed) return@runOnUiThread
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent(${JSONObject.quote(event)}, { detail: ${data} }));", null)
        }
    }

    private fun dispatchCallAction() {
        val action = pendingCallAction ?: return
        if (!pageLoaded) return
        web.evaluateJavascript(
            "window.__connectAndroidPendingCall=${action};window.dispatchEvent(new Event('connect:android-call-action'));", null)
        pendingCallAction = null
    }

    private fun dispatchChatOpen() {
        val id = pendingChatId ?: return
        if (!pageLoaded) return
        web.evaluateJavascript(
            "window.__connectAndroidPendingChat=${JSONObject.quote(id)};window.dispatchEvent(new Event('connect:android-open-chat'));", null)
        pendingChatId = null
    }

    private fun handleLaunchIntent(intent: Intent?) {
        intent?.getStringExtra("connect_chat_id")?.let { id ->
            if (validUuid(id)) pendingChatId = id
        }
        if (pageLoaded) dispatchChatOpen()
        val action = intent?.getStringExtra("connect_call_action") ?: return
        val id = intent.getStringExtra("connect_call_id") ?: return
        if (action !in listOf("open", "accept", "decline") || !validUuid(id)) return
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true); setTurnScreenOn(true)
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        pendingCallAction = JSONObject().put("action", action).put("callId", id)
        if (action != "open") ConnectNotifications.dismissCall(this, id)
        if (pageLoaded) dispatchCallAction()
    }

    private fun showLoadError(details: String) {
        if (loadErrorVisible || isFinishing || isDestroyed) return
        loadErrorVisible = true
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            AlertDialog.Builder(this)
                .setTitle("Connect не загрузился")
                .setMessage("$details\n\nПроверьте соединение или повторите попытку.")
                .setPositiveButton("Повторить") { _, _ -> loadErrorVisible = false; web.loadUrl(site) }
                .setNeutralButton("Открыть в браузере") { _, _ ->
                    loadErrorVisible = false
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(site))) } catch (_: Exception) {}
                }
                .setNegativeButton("Закрыть") { _, _ -> loadErrorVisible = false }
                .show()
        }
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun setPreferences(json: String) {
            try {
                val data = JSONObject(json)
                val sound = data.optString("sound", "soft")
                ConnectNotifications.preferences(this@MainActivity).edit()
                    .putBoolean("enabled", data.optBoolean("enabled", true))
                    .putString("sound", if (sound in setOf("soft", "bright", "gentle", "silent")) sound else "soft")
                    .putBoolean("vibrate", data.optBoolean("vibrate", true))
                    .apply()
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun getSoundSettings(): String {
            val prefs = ConnectNotifications.preferences(this@MainActivity)
            return JSONObject()
                .put("message", prefs.getString("label_message", "Не выбрана"))
                .put("call", prefs.getString("label_call", "Системная мелодия"))
                .put("messageCustom", ConnectNotifications.customUri(this@MainActivity, "message") != null)
                .put("messageSilent", prefs.getBoolean("mute_message", false))
                .put("callSilent", prefs.getBoolean("mute_call", false))
                .put("callCustom", ConnectNotifications.customUri(this@MainActivity, "call") != null)
                .toString()
        }

        @JavascriptInterface
        fun pickSound(kind: String) {
            if (!validKind(kind)) return
            runOnUiThread {
                selectedSoundKind = kind
                try {
                    startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "audio/*"
                    }, soundCode)
                } catch (_: Exception) {
                    selectedSoundKind = null
                    Toast.makeText(this@MainActivity, "Не удалось открыть список мелодий", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun resetSound(kind: String) {
            if (!validKind(kind)) return
            ConnectNotifications.preferences(this@MainActivity).edit()
                .remove("custom_$kind").remove("label_$kind").apply()
            notifyWeb("connect:android-sound-selected", JSONObject().put("kind", kind).put("settings", JSONObject(getSoundSettings())))
        }

        @JavascriptInterface
        fun setSilent(kind: String, muted: Boolean) {
            if (!validKind(kind)) return
            ConnectNotifications.preferences(this@MainActivity).edit()
                .putBoolean("mute_$kind", muted).apply()
            notifyWeb("connect:android-sound-selected", JSONObject().put("kind", kind)
                .put("settings", JSONObject(getSoundSettings())))
        }

        @JavascriptInterface
        fun setSpeakerphone(enabled: Boolean) {
            runOnUiThread {
                try {
                    val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audio.mode = if (enabled) AudioManager.MODE_IN_COMMUNICATION else AudioManager.MODE_NORMAL
                    if (Build.VERSION.SDK_INT >= 31) {
                        if (enabled) {
                            val speaker = audio.availableCommunicationDevices.firstOrNull {
                                it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                            }
                            if (speaker != null) audio.setCommunicationDevice(speaker)
                        } else audio.clearCommunicationDevice()
                    } else {
                        audio.isSpeakerphoneOn = enabled
                    }
                } catch (_: Exception) {}
            }
        }

        @JavascriptInterface
        fun previewSound(kind: String) {
            if (!validKind(kind)) return
            runOnUiThread {
                previewPlayer?.release(); previewPlayer = null
                val uri = ConnectNotifications.customUri(this@MainActivity, kind)
                    ?: if (kind == "call") Settings.System.DEFAULT_RINGTONE_URI else null
                if (uri != null) try {
                    previewPlayer = MediaPlayer().apply {
                        setDataSource(this@MainActivity, uri)
                        setOnCompletionListener { it.release(); if (previewPlayer === it) previewPlayer = null }
                        prepare(); start()
                    }
                } catch (_: Exception) { previewPlayer?.release(); previewPlayer = null }
            }
        }

        @JavascriptInterface
        fun dismissConversationNotifications(conversationId: String) {
            if (validUuid(conversationId)) ConnectNotifications.dismissChat(this@MainActivity, conversationId)
        }

        @JavascriptInterface
        fun setActiveConversation(conversationId: String) {
            ConnectAppPresence.activeConversation = if (validUuid(conversationId)) conversationId else ""
            if (ConnectAppPresence.visible && validUuid(conversationId))
                ConnectNotifications.dismissChat(this@MainActivity, conversationId)
        }

        @JavascriptInterface
        fun setCallState(callId: String, state: String) {
            if (validUuid(callId) && state != "ringing") {
                ConnectNotifications.dismissCall(this@MainActivity, callId)
                runOnUiThread {
                    if (Build.VERSION.SDK_INT >= 27) {
                        setShowWhenLocked(false); setTurnScreenOn(false)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
                    }
                }
            }
        }

        @JavascriptInterface
        fun openCallNotificationSettings() {
            if (Build.VERSION.SDK_INT >= 34 && !ConnectNotifications.manager(this@MainActivity).canUseFullScreenIntent()) {
                runOnUiThread {
                    try {
                        startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                            Uri.parse("package:$packageName")))
                    } catch (_: Exception) { }
                }
            }
        }

        @JavascriptInterface
        fun register(accessToken: String) {
            if (accessToken.isBlank()) return
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), notificationCode)
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (!task.isSuccessful) return@addOnCompleteListener
                    val fcmToken = task.result ?: return@addOnCompleteListener
                    Thread {
                        try {
                            val connection = URL("${site}api/push/register").openConnection() as HttpURLConnection
                            connection.requestMethod = "POST"
                            connection.connectTimeout = 15000
                            connection.readTimeout = 15000
                            connection.doOutput = true
                            connection.setRequestProperty("Content-Type", "application/json")
                            connection.setRequestProperty("Authorization", "Bearer $accessToken")
                            connection.outputStream.use { output ->
                                output.write(JSONObject().put("platform", "android").put("endpoint", fcmToken)
                                    .toString().toByteArray(Charsets.UTF_8))
                            }
                            val ok = connection.responseCode in 200..299
                            connection.disconnect()
                            notifyWeb("connect:android-push-status", JSONObject().put("ok", ok))
                        } catch (_: Exception) {
                            notifyWeb("connect:android-push-status", JSONObject().put("ok", false))
                        }
                    }.start()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        web = WebView(this)
        setContentView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        WebView.setWebContentsDebuggingEnabled(false)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString += " ConnectAndroid/1.3"
        }
        web.addJavascriptInterface(AndroidBridge(), "ConnectAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (uri.scheme == "https" && (uri.host == "connect-chat.duckdns.org" || uri.host == "connect-messenger-mu.vercel.app")) return false
                return try { startActivity(Intent(Intent.ACTION_VIEW, uri)); true } catch (_: Exception) { true }
            }
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                pageLoaded = false
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                if (Uri.parse(url ?: "").host == Uri.parse(site).host) {
                    pageLoaded = true
                    dispatchCallAction()
                    dispatchChatOpen()
                }
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) showLoadError("Ошибка сети: ${error?.description ?: "нет соединения"}")
            }
            override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                if (request?.isForMainFrame == true && (errorResponse?.statusCode ?: 0) >= 400)
                    showLoadError("Сервер вернул код ${errorResponse?.statusCode ?: 0}.")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                chooser?.onReceiveValue(null)
                chooser = callback
                return try {
                    startActivityForResult(params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE)
                    }, chooserCode)
                    true
                } catch (_: Exception) { chooser = null; callback?.onReceiveValue(null); false }
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (request.origin.scheme != "https" || request.origin.host != Uri.parse(site).host) {
                        request.deny(); return@runOnUiThread
                    }
                    val requested = request.resources.toList()
                    val supported = setOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE, PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                    if (requested.isEmpty() || requested.any { it !in supported }) {
                        request.deny(); return@runOnUiThread
                    }
                    val permissions = requested.map {
                        if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) Manifest.permission.CAMERA else Manifest.permission.RECORD_AUDIO
                    }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                    if (permissions.isEmpty()) request.grant(request.resources)
                    else {
                        mediaRequest = request
                        mediaResources = request.resources
                        requestPermissions(permissions.distinct().toTypedArray(), mediaCode)
                    }
                }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                if (mediaRequest === request) mediaRequest = null
            }
        }
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                if (!url.startsWith("https://")) throw IllegalArgumentException("Only HTTPS downloads")
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val req = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent ?: web.settings.userAgentString)
                    CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                    setTitle(name)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(this, "Скачивание началось", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) { Toast.makeText(this, "Не удалось сохранить файл", Toast.LENGTH_SHORT).show() }
        }
        handleLaunchIntent(intent)
        web.loadUrl(site)
    }

    @Deprecated("Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == chooserCode) {
            chooser?.onReceiveValue(if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null)
            chooser = null
        } else if (requestCode == soundCode) {
            val kind = selectedSoundKind
            selectedSoundKind = null
            if (resultCode == RESULT_OK && kind != null && data?.data != null) importSound(kind, data.data!!)
        }
    }

    private fun importSound(kind: String, uri: Uri) {
        try {
            val label = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor: Cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
                ?.take(100) ?: "Своя мелодия"
            val folder = File(filesDir, "sounds")
            if (!folder.exists()) folder.mkdirs()
            val name = "${UUID.randomUUID()}.audio"
            val target = File(folder, name)
            contentResolver.openInputStream(uri)?.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var total = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > 20L * 1024 * 1024) throw IllegalArgumentException("Слишком большой аудиофайл")
                        output.write(buffer, 0, n)
                    }
                    if (total < 100) throw IllegalArgumentException("Пустой аудиофайл")
                }
            } ?: throw IllegalArgumentException("Нет доступа к файлу")
            ConnectNotifications.preferences(this).edit()
                .putString("custom_$kind", name).putString("label_$kind", label).apply()
            notifyWeb("connect:android-sound-selected", JSONObject().put("kind", kind)
                .put("settings", JSONObject(AndroidBridge().getSoundSettings())))
            Toast.makeText(this, "Мелодия выбрана: $label", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Не удалось сохранить мелодию (до 20 МБ)", Toast.LENGTH_LONG).show()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunchIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        ConnectAppPresence.visible = true
        if (pageLoaded) web.evaluateJavascript("window.dispatchEvent(new Event('focus'));", null)
    }

    override fun onPause() {
        ConnectAppPresence.visible = false
        ConnectAppPresence.activeConversation = ""
        super.onPause()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == mediaCode) {
            val request = mediaRequest
            mediaRequest = null
            val allGranted = permissions.isNotEmpty() && permissions.indices.all { grantResults.getOrNull(it) == PackageManager.PERMISSION_GRANTED }
            if (allGranted) request?.grant(mediaResources) else request?.deny()
            mediaResources = emptyArray()
        }
    }

    @Deprecated("Back navigation")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onDestroy() {
        previewPlayer?.release(); previewPlayer = null
        ConnectAppPresence.visible = false
        ConnectAppPresence.activeConversation = ""
        web.destroy()
        super.onDestroy()
    }
}
