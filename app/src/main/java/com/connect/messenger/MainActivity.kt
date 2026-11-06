package com.connect.messenger

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var audioRequest: PermissionRequest? = null
    private val site = "https://connect-chat.duckdns.org/"
    private val chooserCode = 1001
    private val micCode = 1002
    private val notificationCode = 1003
    private var loadErrorVisible = false

    // Errors used to appear as a blank screen. Make the failure visible and retryable.
    private fun showLoadError(details: String) {
        if (loadErrorVisible || isFinishing || isDestroyed) return
        loadErrorVisible = true
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            android.app.AlertDialog.Builder(this)
                .setTitle("Connect не загрузился")
                .setMessage("$details\n\nПроверьте интернет или повторите попытку.")
                .setPositiveButton("Повторить") { _, _ ->
                    loadErrorVisible = false
                    web.loadUrl(site)
                }
                .setNeutralButton("Открыть в браузере") { _, _ ->
                    loadErrorVisible = false
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(site))) } catch (_: Exception) { }
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
                getSharedPreferences("connect_push", Context.MODE_PRIVATE).edit()
                    .putBoolean("enabled", data.optBoolean("enabled", true))
                    .putString("sound", data.optString("sound", "soft"))
                    .putBoolean("vibrate", data.optBoolean("vibrate", true))
                    .apply()
            } catch (_: Exception) { }
        }

        @JavascriptInterface
        fun register(accessToken: String) {
            if (accessToken.isBlank()) return
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), notificationCode)
                }
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (!task.isSuccessful) {
                        Toast.makeText(this@MainActivity, "Не удалось получить токен уведомлений", Toast.LENGTH_LONG).show()
                        return@addOnCompleteListener
                    }
                    val fcmToken = task.result ?: return@addOnCompleteListener
                    Thread {
                        try {
                            val connection = java.net.URL("${site}api/push/register").openConnection() as java.net.HttpURLConnection
                            connection.requestMethod = "POST"
                            connection.connectTimeout = 15000
                            connection.readTimeout = 15000
                            connection.doOutput = true
                            connection.setRequestProperty("Content-Type", "application/json")
                            connection.setRequestProperty("Authorization", "Bearer $accessToken")
                            connection.outputStream.use { it.write(JSONObject().put("platform", "android").put("endpoint", fcmToken).toString().toByteArray(Charsets.UTF_8)) }
                            val success = connection.responseCode in 200..299
                            connection.disconnect()
                            runOnUiThread {
                                Toast.makeText(this@MainActivity, if (success) "Устройство зарегистрировано для уведомлений" else "Ошибка регистрации уведомлений", Toast.LENGTH_LONG).show()
                            }
                        } catch (_: Exception) {
                            runOnUiThread { Toast.makeText(this@MainActivity, "Не удалось подключить уведомления", Toast.LENGTH_LONG).show() }
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
            userAgentString = userAgentString + " ConnectAndroid/1.0"
        }
        // Only the trusted Connect origin is allowed inside this WebView.
        web.addJavascriptInterface(AndroidBridge(), "ConnectAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (uri.scheme == "https" && (uri.host == "connect-chat.duckdns.org" || uri.host == "connect-messenger-mu.vercel.app" || uri.host?.endsWith(".supabase.co") == true)) return false
                return try { startActivity(Intent(Intent.ACTION_VIEW, uri)); true } catch (_: Exception) { false }
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    showLoadError("Ошибка сети: ${error?.description ?: "соединение недоступно"}")
                }
            }
            override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame == true && (errorResponse?.statusCode ?: 0) >= 400) {
                    showLoadError("Сервер вернул код ${errorResponse?.statusCode ?: 0}.")
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                chooser?.onReceiveValue(null)
                chooser = callback
                return try {
                    startActivityForResult(params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, chooserCode)
                    true
                } catch (_: Exception) { chooser = null; callback?.onReceiveValue(null); false }
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (request.origin.host != Uri.parse(site).host || !request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return@runOnUiThread }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    else { audioRequest = request; requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), micCode) }
                }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest?) { if (audioRequest === request) audioRequest = null }
        }
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                if (!url.startsWith("https://")) throw IllegalArgumentException("Only HTTPS downloads are supported")
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent ?: web.settings.userAgentString)
                    val cookies = CookieManager.getInstance().getCookie(url)
                    if (!cookies.isNullOrEmpty()) addRequestHeader("Cookie", cookies)
                    setTitle(name)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "Скачивание началось", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) { Toast.makeText(this, "Не удалось сохранить файл", Toast.LENGTH_SHORT).show() }
        }
        web.loadUrl(site)
    }

    @Deprecated("Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == chooserCode) {
            val result = if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null
            chooser?.onReceiveValue(result)
            chooser = null
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == micCode) {
            val request = audioRequest
            audioRequest = null
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) request?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request?.deny()
        }
    }

    @Deprecated("Back navigation")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }
}
