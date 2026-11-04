
package com.connect.messenger

import android.Manifest
import android.webkit.JavascriptInterface
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.os.Build
import android.content.Context
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.DownloadListener

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var audioRequest: PermissionRequest? = null
    private val site = "https://connect-messenger-mu.vercel.app/"
    private val chooserCode = 1001
    private val micCode = 1002

    private inner class NativeBridge {
        @JavascriptInterface fun setPreferences(json: String) {
            try { val obj=JSONObject(json);getSharedPreferences("connect_push",Context.MODE_PRIVATE).edit().putBoolean("enabled",obj.optBoolean("enabled",true)).putString("sound",obj.optString("sound","soft")).putBoolean("vibrate",obj.optBoolean("vibrate",true)).apply() } catch (_:Exception) {}
        }
        @JavascriptInterface fun register(accessToken: String) {
            if (accessToken.length < 20 || accessToken.length > 8192) return
            FirebaseMessaging.getInstance().token.addOnSuccessListener { fcm ->
                Thread {
                    try {
                        val connection=URL("https://connect-messenger-mu.vercel.app/api/push/register").openConnection() as HttpURLConnection
                        connection.requestMethod="POST";connection.connectTimeout=10000;connection.readTimeout=10000;connection.doOutput=true
                        connection.setRequestProperty("Content-Type","application/json")
                        connection.setRequestProperty("Authorization","Bearer $accessToken")
                        val payload=JSONObject().put("platform","android").put("endpoint",fcm).toString()
                        connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                        val status=connection.responseCode
                        connection.disconnect()
                        runOnUiThread { Toast.makeText(this@MainActivity,if(status in 200..299) "Уведомления подключены" else "Ошибка подключения: $status",Toast.LENGTH_SHORT).show() }
                    }catch (_:Exception){runOnUiThread { Toast.makeText(this@MainActivity,"Ошибка подключения уведомлений",Toast.LENGTH_SHORT).show() }}
                }.start()
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
        web.addJavascriptInterface(NativeBridge(),"ConnectAndroid")
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),1003)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (uri.scheme == "https" && uri.host == "connect-messenger-mu.vercel.app") return false
                return try { startActivity(Intent(Intent.ACTION_VIEW, uri)); true } catch (_: Exception) { false }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                chooser?.onReceiveValue(null)
                chooser = callback
                return try { startActivityForResult(params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, chooserCode); true }
                catch (_: Exception) { chooser = null; callback?.onReceiveValue(null); false }
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
        web.setDownloadListener { url, _, _, _, _ ->
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            catch (_: Exception) { Toast.makeText(this, "Не удалось открыть файл", Toast.LENGTH_SHORT).show() }
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
