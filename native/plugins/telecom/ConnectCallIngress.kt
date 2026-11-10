package com.connect.messenger

import android.app.job.*
import android.content.*
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** Durable hints only: never show or ring until the authenticated server row is checked. */
internal object ConnectCallIngress {
    private const val JOB=0x434351
    private val handler=Handler(Looper.getMainLooper())
    private val recent=mutableMapOf<String,Long>()
    private val scheduled=mutableSetOf<String>()
    private fun prefs(c:Context)=c.getSharedPreferences("connect_call_hints",0)
    fun receive(c:Context,kind:String?,id:String?):Boolean {
        if(kind !in listOf("incoming-call","call-ended")||id==null||!id.matches(Regex("[0-9a-fA-F-]{36}")))return false
        val call=id.lowercase();val key="$kind:$call";val now=System.currentTimeMillis()
        synchronized(recent){
            recent.entries.removeAll{now-it.value>60000}
            if(now-(recent[key]?:0)<1000)return true
            recent[key]=now
        }
        ConnectCallDiagnostics.event(c,call,"fcm","received",kind!!)
        if(kind=="call-ended"){
            // End hints cannot suppress a newer/active call: the service checks its server row.
            ConnectCallService.action(c,"remote-end",call)
            return true
        }
        val owner=try{ConnectCallSession.peekOwner(c)?: ""}catch(_:Exception){""}
        val p=prefs(c)
        p.all.entries.sortedBy{it.key}.take((p.all.size-7).coerceAtLeast(0)).forEach{p.edit().remove(it.key).apply()}
        if(!p.contains(call))p.edit().putString(call,JSONObject().put("expires",now+60000).put("owner",owner).toString()).commit()
        schedule(c)
        if(ConnectCallSession.hasSession(c)&&!ConnectCallService.action(c,"incoming",call))retry(c,call)
        return true
    }
    fun acknowledge(c:Context,id:String){prefs(c).edit().remove(id).apply()}
    fun retry(c:Context,id:String){
        val app=c.applicationContext
        synchronized(scheduled){if(!scheduled.add(id))return}
        handler.postDelayed({synchronized(scheduled){scheduled.remove(id)};drain(app)},2500)
        schedule(app)
    }
    fun drain(c:Context){
        val owner=try{ConnectCallSession.peekOwner(c)?: ""}catch(_:Exception){""}
        val p=prefs(c);val now=System.currentTimeMillis()
        for((id,raw)in p.all){
            val item=try{JSONObject(raw as String)}catch(_:Exception){p.edit().remove(id).apply();continue}
            val bound=item.optString("owner")
            if(!ConnectCallHintPolicy.accepts(item.optLong("expires"),bound,owner,now)){acknowledge(c,id);continue}
            if(owner.isNotEmpty()&&!ConnectCallService.action(c,"incoming",id))retry(c,id)
        }
    }
    private fun schedule(c:Context){
        if(prefs(c).all.isEmpty())return
        c.getSystemService(JobScheduler::class.java).schedule(JobInfo.Builder(JOB,ComponentName(c,ConnectCallHintJob::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setBackoffCriteria(10000,JobInfo.BACKOFF_POLICY_LINEAR).setPersisted(true).build())
    }
    fun hasPending(c:Context)=prefs(c).all.isNotEmpty()
    fun clear(c:Context){prefs(c).edit().clear().apply();c.getSystemService(JobScheduler::class.java).cancel(JOB)}
}

class ConnectCallHintJob:JobService(){
    override fun onStartJob(params:JobParameters):Boolean{
        ConnectCallIngress.drain(this)
        Handler(Looper.getMainLooper()).postDelayed({jobFinished(params,ConnectCallIngress.hasPending(this))},3000);return true
    }
    override fun onStopJob(params:JobParameters)=ConnectCallIngress.hasPending(this)
}

class ConnectCallRestoreReceiver:BroadcastReceiver(){
    override fun onReceive(context:Context,intent:Intent){
        if(intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED,Intent.ACTION_MY_PACKAGE_REPLACED))return
        if(ConnectCallSession.hasSession(context))ConnectPushTokenJob.enable(context)
        ConnectCallIngress.drain(context)
    }
}
