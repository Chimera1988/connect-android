package com.connect.messenger

import android.app.*
import android.app.job.*
import android.content.*
import android.os.*
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/** Sole owner of persistent missed-call alerts. Live-call teardown never touches these IDs. */
internal object ConnectMissedCalls {
    private const val CHANNEL="connect-native-missed-calls-v1"
    private const val NOTIFICATION=0x434d43
    private const val JOB=0x434d4a
    private val worker=java.util.concurrent.Executors.newSingleThreadExecutor()
    private val inFlight=mutableSetOf<String>()
    private val lock=Any()
    private val validatedAt=mutableMapOf<String,Long>()
    @Volatile var observer:((String)->Unit)?=null
    @Volatile var foreground=false
    @Volatile private var journalOwner=""
    @Volatile private var accountOwner=""
    private fun prefs(c:Context)=c.getSharedPreferences("connect_missed_calls_v1",0)
    private fun valid(value:String)=value.matches(Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"))
    private fun currentOwner(c:Context):String?=try{ConnectCallSession.peekOwner(c)}catch(_:Exception){null}
    private fun time(s:String?):Long?=ConnectCallTiming.parse(s?:"")
    private fun entry(owner:String,id:String)="entry:$owner:$id"
    private fun tag(owner:String,id:String)=ConnectMissedLedger.notificationTag(owner,id)
    private fun viewing(c:Context,owner:String)=journalOwner==owner&&foreground&&c.getSystemService(PowerManager::class.java).isInteractive&&!c.getSystemService(KeyguardManager::class.java).isKeyguardLocked
    private fun eligible(row:JSONObject,owner:String):Boolean{
        val live=ConnectCallService.snapshot();val active=if(live.optString("state") in listOf("ANSWERING","CONNECTING","ACTIVE","RECONNECTING"))live.optString("callId")else ""
        return ConnectMissedPolicy.isMissedIncomingCall(row.optString("id"),row.optString("callee_id"),row.optString("status"),row.optString("created_at"),row.opt("answered_at")?.takeUnless{it==JSONObject.NULL}?.toString(),row.opt("ended_at")?.takeUnless{it==JSONObject.NULL}?.toString(),owner,System.currentTimeMillis(),active)
    }
    private fun eventTime(row:JSONObject)=time(row.optString("ended_at"))?:time(row.optString("created_at"))?:0L
    fun state(c:Context,owner:String):JSONObject=synchronized(lock){
        val p=prefs(c);val viewed=p.getLong("viewed:$owner",0);val count=ConnectMissedLedger.unseen(p.all.filterKeys{it.startsWith("entry:$owner:")}.values.mapNotNull{it as? Long},viewed)
        JSONObject().put("lastViewed",viewed).put("count",count)
    }
    private fun changed(owner:String){try{observer?.invoke(owner)}catch(_:Exception){}}
    fun viewed(c:Context,owner:String,at:Long=System.currentTimeMillis(),includeCurrent:Boolean=true):JSONObject=synchronized(lock){
        val p=prefs(c);val entries=p.all.filterKeys{it.startsWith("entry:$owner:")};val high=ConnectMissedLedger.viewedMarker(p.getLong("viewed:$owner",0),at,entries.values.mapNotNull{it as? Long},includeCurrent)
        val edit=p.edit().putLong("viewed:$owner",high)
        for((key,value)in entries)if((value as? Long?:0)<=high){edit.remove(key);edit.remove("posted:$owner:"+key.substringAfterLast(':'))}
        edit.apply()
        c.getSystemService(NotificationManager::class.java).activeNotifications.filter{it.tag?.startsWith("connect-missed:$owner:")==true&&it.notification.`when`<=high}.forEach{c.getSystemService(NotificationManager::class.java).cancel(it.tag,it.id)}
        if(entries.isNotEmpty())changed(owner);state(c,owner)
    }
    fun journal(c:Context,owner:String,data:JSONObject):JSONObject=synchronized(lock){
        check(valid(owner)&&currentOwner(c)==owner){"Account changed"}
        when(data.optString("action")){
            "view"->{journalOwner=owner;return viewed(c,owner)}
            "seed"->{val at=data.optLong("at");if(at>0)return viewed(c,owner,at,false)}
            "close"->{if(journalOwner==owner)journalOwner=""}
            "reconcile"->{
                val rows=data.optJSONArray("rows")?:JSONArray();require(rows.length()<=200)
                val p=prefs(c);val edit=p.edit();val marker=p.getLong("viewed:$owner",0)
                for(i in 0 until rows.length()){
                    val row=rows.getJSONObject(i);val id=row.optString("id");if(!valid(id))continue
                    val at=eventTime(row)
                    if(eligible(row,owner)&&!row.optBoolean("hidden")&&at>marker)edit.putLong(entry(owner,id),at)
                    else{edit.remove(entry(owner,id));c.getSystemService(NotificationManager::class.java).cancel(tag(owner,id),NOTIFICATION)}
                };edit.apply()
                if(viewing(c,owner))return viewed(c,owner)
            }
        }
        state(c,owner)
    }
    fun accountChanged(c:Context,owner:String){
        if(accountOwner!=owner){journalOwner="";accountOwner=owner}
        c.getSystemService(NotificationManager::class.java).activeNotifications.filter{it.tag?.startsWith("connect-missed:")==true&&!it.tag!!.startsWith("connect-missed:$owner:")}.forEach{c.getSystemService(NotificationManager::class.java).cancel(it.tag,it.id)}
        restore(c)
    }
    fun receive(c:Context,data:Map<String,String>):Boolean{
        if(data["kind"]!="missed-call")return false
        val owner=data["userId"]?:"";val id=data["callId"]?:""
        if(!valid(owner)||!valid(id))return true
        val key="pending:$owner:$id";val app=c.applicationContext
        val hint=JSONObject().put("owner",owner).put("id",id).put("received",System.currentTimeMillis()).put("title",(data["title"]?:"Пропущенный звонок").take(120)).put("body",(data["body"]?:"Откройте журнал звонков").take(180)).toString()
        ConnectCallDiagnostics.event(app,id,"missed-push","RECEIVED")
        val queued=ConnectMissedDelivery.enqueue({prefs(app).edit().putString(key,hint).commit()},{schedule(app)},{restore(app)})
        if(!queued)ConnectCallDiagnostics.event(app,id,"missed-push","FAILED","QUEUE_STORAGE_FAILED")
        return true
    }
    fun restore(c:Context){
        val app=c.applicationContext
        worker.execute{
          val owner=currentOwner(app)
          if(owner!=null&&System.currentTimeMillis()-(validatedAt[owner]?:0)>60000){
            validatedAt[owner]=System.currentTimeMillis();if(validatedAt.size>4)validatedAt.keys.firstOrNull{it!=owner}?.let{validatedAt.remove(it)}
            val p=prefs(app);val edit=p.edit()
            for((key,value)in p.all.filterKeys{it.startsWith("entry:$owner:")}.entries.take(100)){
              val id=key.substringAfterLast(':');val pending="pending:$owner:$id"
              if(!p.contains(pending))edit.putString(pending,JSONObject().put("owner",owner).put("id",id).put("received",System.currentTimeMillis()).toString())
            };edit.apply()
          }
          val retry=try{drain(app)}catch(_:Exception){true};if(retry)schedule(app)}
    }
    private fun schedule(c:Context){
        try{c.getSystemService(JobScheduler::class.java).schedule(JobInfo.Builder(JOB,ComponentName(c,ConnectMissedCallJob::class.java)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setMinimumLatency(10000).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build())}catch(_:Exception){}
    }
    private fun forget(c:Context,owner:String,id:String){synchronized(lock){prefs(c).edit().remove(entry(owner,id)).remove("posted:$owner:$id").apply();c.getSystemService(NotificationManager::class.java).cancel(tag(owner,id),NOTIFICATION)}}
    fun drain(c:Context):Boolean{
        var retry=false
        for((key,value)in prefs(c).all.filterKeys{it.startsWith("pending:")}.entries.take(100)){
            val hint=try{JSONObject(value as String)}catch(_:Exception){prefs(c).edit().remove(key).apply();continue}
            val owner=hint.optString("owner");val id=hint.optString("id")
            if(System.currentTimeMillis()-hint.optLong("received")>7L*86400000){prefs(c).edit().remove(key).apply();continue}
            val current=currentOwner(c)
            if(current.isNullOrEmpty()){retry=true;continue}
            if(current!=owner){prefs(c).edit().remove(key).apply();continue}
            if(!c.getSharedPreferences("connect_call_settings",0).getBoolean("pushEnabled",true)){prefs(c).edit().remove(key).apply();continue}
            if(!synchronized(lock){inFlight.add(key)}){retry=true;continue}
            try{
                val epoch=ConnectCallSession.epoch
                val rows=JSONArray(ConnectCallSession.api(c,"/supabase/rest/v1/connect_calls?id=eq.$id&select=id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at&limit=1",expectedOwner=owner))
                val row=rows.optJSONObject(0)
                if(epoch!=ConnectCallSession.epoch||currentOwner(c)!=owner){retry=true;continue}
                if(row==null||!eligible(row,owner)){forget(c,owner,id);prefs(c).edit().remove(key).apply();ConnectCallDiagnostics.event(c,id,"missed-push","IGNORED","SERVER_NOT_MISSED");continue}
                val settings=JSONArray(ConnectCallSession.api(c,"/supabase/rest/v1/connect_call_journal_settings?owner_id=eq.$owner&select=hidden_ids,cleared_before&limit=1",expectedOwner=owner)).optJSONObject(0)
                val hidden=settings?.optJSONArray("hidden_ids")?.let{(0 until it.length()).any{i->it.optString(i)==id}}==true
                val cutoff=time(settings?.optString("cleared_before"))?:0
                if(hidden||(time(row.optString("created_at"))?:0)<=cutoff){forget(c,owner,id);prefs(c).edit().remove(key).apply();continue}
                synchronized(lock){
                    if(epoch!=ConnectCallSession.epoch||currentOwner(c)!=owner){retry=true;return@synchronized}
                    val p=prefs(c);val at=eventTime(row)
                    if(at>p.getLong("viewed:$owner",0))p.edit().putLong(entry(owner,id),at).apply()
                    if(viewing(c,owner))viewed(c,owner)
                    else if(ConnectMissedLedger.shouldPost(at,p.getLong("viewed:$owner",0),p.getBoolean("posted:$owner:$id",false),false)){
                        val manager=c.getSystemService(NotificationManager::class.java)
                        if(manager.getNotificationChannel(CHANNEL)==null)manager.createNotificationChannel(NotificationChannel(CHANNEL,"Connect · Пропущенные звонки",NotificationManager.IMPORTANCE_DEFAULT))
                        if(manager.areNotificationsEnabled()&&manager.getNotificationChannel(CHANNEL)?.importance!=NotificationManager.IMPORTANCE_NONE){
                            val intent=Intent(c,MainActivity::class.java).setAction(c.packageName+".MISSED_CALL").setData(android.net.Uri.parse("connect://missed/$owner/$id")).putExtra("connectMissedOwner",owner).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                            val open=PendingIntent.getActivity(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                            manager.notify(tag(owner,id),NOTIFICATION,NotificationCompat.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_launcher_monochrome).setContentTitle(hint.optString("title","Пропущенный звонок")).setContentText(hint.optString("body","Откройте журнал звонков")).setWhen(at).setCategory("missed_call").setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).setAutoCancel(false).setContentIntent(open).build())
                            p.edit().putBoolean("posted:$owner:$id",true).apply();ConnectCallDiagnostics.event(c,id,"missed-push","NOTIFICATION_POSTED")
                        }
                    }
                }
                prefs(c).edit().remove(key).apply();changed(owner)
            }catch(error:Exception){retry=true;ConnectCallDiagnostics.event(c,id,"missed-push","RETRY",if(error is ConnectCallSession.HttpFailure)"HTTP_${error.status}" else "NETWORK_OR_SESSION")}
            finally{synchronized(lock){inFlight.remove(key)}}
        }
        return retry
    }
}
class ConnectMissedCallJob:JobService(){
    override fun onStartJob(params:JobParameters):Boolean{ConnectCallSession.network.execute{val retry=try{ConnectMissedCalls.drain(applicationContext)}catch(_:Exception){true};Handler(Looper.getMainLooper()).post{jobFinished(params,retry)}};return true}
    override fun onStopJob(params:JobParameters)=true
}
