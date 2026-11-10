package com.connect.messenger

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.util.UUID

/** No SDP, candidates, network addresses, credentials, names or audio data. */
internal object ConnectCallDiagnostics {
    private val disk=java.util.concurrent.Executors.newSingleThreadExecutor()
    fun event(context: Context, callId: String, stage: String, state: String = "", code: String = "") {
        val prefs=context.getSharedPreferences("connect_call_diagnostics",0)
        val device=prefs.getString("device",null)?:UUID.randomUUID().toString().also{prefs.edit().putString("device",it).apply()}
        fun safe(value:String)=value.replace(Regex("[^A-Za-z0-9_.:-]"),"").take(80)
        val line=JSONObject().put("time",java.time.Instant.now().toString()).put("elapsedMs",android.os.SystemClock.elapsedRealtime())
            .put("sdk",android.os.Build.VERSION.SDK_INT).put("version",context.packageManager.getPackageInfo(context.packageName,0).versionName)
            .put("device",device).put("callId",safe(callId)).put("stage",safe(stage)).put("state",safe(state)).put("code",safe(code)).toString()
        Log.i("ConnectCall",line)
        val app=context.applicationContext
        disk.execute { try {
            val dir=java.io.File(app.filesDir,"call-diagnostics").apply{mkdirs()}
            val file=java.io.File(dir,"calls.jsonl")
            if(file.length()>256*1024){val old=java.io.File(dir,"previous.jsonl");old.delete();file.renameTo(old)}
            file.appendText(line+"\n")
        } catch(_:Exception){} }
    }
    fun export(activity:android.app.Activity){
        disk.execute { try {
            val folder=java.io.File(activity.cacheDir,"connect-call-export").apply{mkdirs()}
            val file=java.io.File(folder,"Connect-Call-Diagnostics.txt")
            file.writeText("Connect native call diagnostics. Contains device/call IDs and technical states; no tokens, SDP, audio or message content.\n")
            val source=java.io.File(activity.filesDir,"call-diagnostics")
            for(name in listOf("previous.jsonl","calls.jsonl")){val part=java.io.File(source,name);if(part.exists())file.appendText(part.readText())}
            val uri=androidx.core.content.FileProvider.getUriForFile(activity,activity.packageName+".call-diagnostics",file)
            activity.runOnUiThread{activity.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND)
                .setType("text/plain").putExtra(android.content.Intent.EXTRA_STREAM,uri).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION),"Сохранить диагностику звонков"))}
        }catch(_:Exception){activity.runOnUiThread{android.widget.Toast.makeText(activity,"Не удалось сохранить диагностику",android.widget.Toast.LENGTH_LONG).show()}} }
    }
}
