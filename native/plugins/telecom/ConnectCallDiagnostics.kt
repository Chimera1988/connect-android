package com.connect.messenger

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.util.UUID

/** No SDP, candidates, network addresses, credentials, names or audio data. */
internal object ConnectCallDiagnostics {
    fun event(context: Context, callId: String, stage: String, state: String = "", code: String = "") {
        val prefs=context.getSharedPreferences("connect_call_diagnostics",0)
        val device=prefs.getString("device",null)?:UUID.randomUUID().toString().also{prefs.edit().putString("device",it).apply()}
        fun safe(value:String)=value.replace(Regex("[^A-Za-z0-9_.:-]"),"").take(80)
        Log.i("ConnectCall",JSONObject().put("device",device).put("callId",safe(callId)).put("stage",safe(stage)).put("state",safe(state)).put("code",safe(code)).toString())
    }
}
