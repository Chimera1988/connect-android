package com.connect.messenger

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService
import org.json.JSONObject

/** Token rotation must reach the existing server even when React never starts. */
class ConnectPushTokenService : ReactNativeFirebaseMessagingService() {
    override fun onNewToken(token:String){
        try { ConnectPushTokenJob.save(applicationContext,token) }
        catch(_:Exception){android.util.Log.w("ConnectPush","TOKEN_SAVE_FAILED")}
        super.onNewToken(token)
    }
}

class ConnectPushTokenJob : JobService(){
    companion object {
        private const val JOB=0x43544b
        private const val RECORD="connect-fcm-pending-v1"
        fun save(c:Context,token:String){
            if(token.isBlank()||token.length>8192||!ConnectCallSession.hasSession(c))return
            val owner=ConnectCallSession.peekOwner(c)?:return
            ConnectCallSession.write(c,RECORD,JSONObject().put("owner",owner).put("token",token).toString())
            schedule(c,true)
        }
        private fun schedule(c:Context,replace:Boolean=false){
            if(!c.getSharedPreferences("connect_call_settings",0).getBoolean("pushEnabled",true))return
            if(ConnectCallSession.read(c,RECORD)==null)return
            val scheduler=c.getSystemService(JobScheduler::class.java)
            if(!replace&&scheduler.getPendingJob(JOB)!=null)return
            scheduler.schedule(JobInfo.Builder(JOB,ComponentName(c,ConnectPushTokenJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).setPersisted(true).build())
        }
        fun enable(c:Context){c.getSharedPreferences("connect_call_settings",0).edit().putBoolean("pushEnabled",true).apply();schedule(c)}
        fun cancel(c:Context){c.getSharedPreferences("connect_call_settings",0).edit().putBoolean("pushEnabled",false).apply();c.getSystemService(JobScheduler::class.java).cancel(JOB);ConnectCallSession.write(c,RECORD,null)}
    }
    @Volatile private var stopped=false
    override fun onStartJob(params:JobParameters):Boolean{
        stopped=false
        ConnectCallSession.network.execute {
            var retry=false
            try{
                val raw=ConnectCallSession.read(this,RECORD)
                if(raw!=null&&ConnectCallSession.hasSession(this)&&getSharedPreferences("connect_call_settings",0).getBoolean("pushEnabled",true)){
                    val pending=JSONObject(raw);val credentials=ConnectCallSession.credentials(this)
                    if(pending.optString("owner")==credentials.owner){
                        val data=JSONObject().put("platform","android").put("endpoint",pending.getString("token"))
                        ConnectCallSession.requestWithToken("/api/push/register",data,credentials.token)
                        // Account changes/cancellation cannot leave a newly registered
                        // endpoint attached to the previous account.
                        if(stopped||ConnectCallSession.epoch!=credentials.epoch||!getSharedPreferences("connect_call_settings",0).getBoolean("pushEnabled",true))
                            ConnectCallSession.requestWithToken("/api/push/register",JSONObject().put("endpoint",pending.getString("token")),credentials.token,"DELETE")
                    }
                    if(ConnectCallSession.read(this,RECORD)==raw)ConnectCallSession.write(this,RECORD,null)
                }
            }catch(_:Exception){retry=ConnectCallSession.hasSession(this)&&getSharedPreferences("connect_call_settings",0).getBoolean("pushEnabled",true)}
            finally{if(!stopped)jobFinished(params,retry)}
        }
        return true
    }
    override fun onStopJob(params:JobParameters):Boolean{stopped=true;return true}
}
