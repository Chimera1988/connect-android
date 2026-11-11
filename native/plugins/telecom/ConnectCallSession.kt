package com.connect.messenger

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/** Device-local session only. Secrets stay encrypted by Android Keystore, never logs/Intents. */
internal object ConnectCallSession {
    class HttpFailure(val status:Int):IllegalStateException("Сервер звонков: HTTP $status")
    const val BASE = "https://connect-chat.duckdns.org"
    const val KEY = "sb_publishable_tAg8rPwuBNcA2iPF7voc2Q_vsKUpyZa"
    val worker = Executors.newSingleThreadExecutor()
    val network = Executors.newFixedThreadPool(2)
    @Volatile var epoch=0;private set
    private val lock = Any()
    private fun prefs(c: Context) = c.getSharedPreferences("connect_call_auth", 0)
    private fun key(): java.security.Key {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (ks.containsAlias("ConnectCallAuthV1")) return ks.getKey("ConnectCallAuthV1", null)
        return KeyGenerator.getInstance("AES", "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("ConnectCallAuthV1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(c: Context, name: String): String? = synchronized(lock) {
        val text = prefs(c).getString(name, null) ?: return@synchronized null
        val raw = Base64.decode(text, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        cipher.updateAAD(name.toByteArray())
        String(cipher.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8)
    }
    fun write(c: Context, name: String, value: String?) = synchronized(lock) {
        require(name.matches(Regex("[A-Za-z0-9_.:-]{1,180}")) && (value?.length ?: 0) <= 131072)
        if(name.endsWith("-auth-token")){
            val previous=try{JSONObject(read(c,name)?:"{}").optJSONObject("user")?.optString("id")}catch(_:Exception){null}
            val next=try{JSONObject(value?:"{}").optJSONObject("user")?.optString("id")}catch(_:Exception){null}
            if(previous!=next)epoch++
        }
        val editor = prefs(c).edit()
        if (value == null) editor.remove(name) else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(name.toByteArray())
            editor.putString(name, Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP))
            if (name.endsWith("-auth-token")) editor.putString("current", name)
        }
        check(editor.commit()) { "Не удалось сохранить сессию" }
    }
    fun hasSession(c: Context) = prefs(c).getString("current", null)?.let { prefs(c).contains(it) } == true
    fun peekOwner(c:Context):String?=synchronized(lock){prefs(c).getString("current",null)?.let{JSONObject(read(c,it)?:"{}").optJSONObject("user")?.optString("id")}}
    fun session(c: Context): JSONObject = synchronized(lock) {
        val name = prefs(c).getString("current", null) ?: error("Войдите в Connect")
        var saved = JSONObject(read(c, name) ?: error("Войдите в Connect"))
        if (saved.optLong("expires_at") * 1000 < System.currentTimeMillis() + 30000) {
            val refresh = saved.optString("refresh_token"); check(refresh.isNotEmpty()) { "Сессия истекла" }
            val fresh = request("/supabase/auth/v1/token?grant_type=refresh_token", "POST", JSONObject().put("refresh_token", refresh).toString(), null)
            saved = JSONObject(fresh)
            if (!saved.has("expires_at")) saved.put("expires_at", System.currentTimeMillis() / 1000 + saved.optLong("expires_in", 3600))
            write(c, name, saved.toString())
        }
        saved
    }
    fun owner(c: Context) = session(c).getJSONObject("user").getString("id")
    fun identity(c:Context):Pair<String,Int> = synchronized(lock){owner(c) to epoch}
    data class Credentials(val owner:String,val token:String,val epoch:Int)
    fun credentials(c:Context):Credentials=synchronized(lock){val saved=session(c);Credentials(saved.getJSONObject("user").getString("id"),saved.getString("access_token"),epoch)}
    fun requestWithToken(path:String,body:JSONObject,token:String,method:String="POST")=request(path,method,body.toString(),token)
    fun api(c: Context, path: String, body: JSONObject? = null, expectedOwner:String?=null): String {
        val saved=session(c)
        if(expectedOwner!=null)check(saved.getJSONObject("user").getString("id")==expectedOwner){"Аккаунт изменился"}
        val token = saved.getString("access_token")
        return request(path, if (body == null) "GET" else "POST", body?.toString(), token)
    }
    fun insertBatch(c:Context,path:String,rows:org.json.JSONArray,expectedOwner:String):String{
        require(rows.length() in 1..20)
        val auth=credentials(c);check(auth.owner==expectedOwner){"Аккаунт изменился"}
        return request(path,"POST",rows.toString(),auth.token)
    }
    private fun request(path: String, method: String, body: String?, token: String?): String {
        check(path.startsWith("/supabase/") || path.startsWith("/api/"))
        val connection = URL(BASE + path).openConnection() as HttpURLConnection
        try {
            connection.useCaches=false;connection.setRequestProperty("Cache-Control","no-cache")
            connection.connectTimeout = 4000; connection.readTimeout = 4000; connection.requestMethod = method
            connection.setRequestProperty("apikey", KEY)
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) { connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json"); connection.outputStream.use { it.write(body.toByteArray()) } }
            val status=connection.responseCode
            ConnectCallServerClock.observe(connection.date,android.os.SystemClock.elapsedRealtime())
            if (status !in 200..299) throw HttpFailure(status)
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally { connection.disconnect() }
    }
}
