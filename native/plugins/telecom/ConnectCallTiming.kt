package com.connect.messenger

import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/** Android 10's Instant.parse accepts Z only. PostgREST sends numeric offsets. */
internal object ConnectCallTiming {
    const val RING_MS = 60000L
    fun parse(value:String):Long? = try {
        if(value.length !in 20..48)null else OffsetDateTime.parse(value,DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant().toEpochMilli()
    }catch(_:Exception){null}
    data class Window(val deadline:Long,val age:Long,val remaining:Long,val reason:String){val valid get()=reason=="VALID"}
    fun window(created:Long?,serverNow:Long,elapsedNow:Long):Window {
        if(created==null||created<=0)return Window(0,0,0,"INVALID_TIMESTAMP")
        val age=serverNow-created
        if(age < -10000)return Window(0,age,0,"FUTURE_TIMESTAMP")
        if(age>=RING_MS)return Window(0,age,0,"EXPIRED")
        val remaining=RING_MS-age.coerceAtLeast(0)
        return Window(elapsedNow+remaining,age,remaining,"VALID")
    }
    fun expired(generation:Int,current:Int,deadline:Long,now:Long)=generation==current&&deadline>0&&now>=deadline
}

/** Authenticated HTTPS response Date calibrates age; countdown uses elapsedRealtime. */
internal object ConnectCallServerClock {
    @Volatile private var sample:Pair<Long,Long>?=null
    fun observe(epoch:Long,elapsed:Long){if(epoch>0)sample=epoch to elapsed}
    fun now(elapsed:Long,wallFallback:Long):Long=sample?.let{it.first+(elapsed-it.second).coerceAtLeast(0)}?:wallFallback
    fun source()=if(sample==null)"DEVICE_WALL" else "HTTPS_DATE"
}

/** The logical incoming owner survives service recreation. No UI or Android dependencies. */
internal class ConnectIncomingGate {
    private data class Entry(var phase:String,val expires:Long,var retryAt:Long=0)
    private val entries=mutableMapOf<String,Entry>()
    @Synchronized fun dispatch(id:String,now:Long):String {
        entries.entries.removeAll{now>=it.value.expires}
        val old=entries[id]
        if(old!=null){
            if(old.phase=="TERMINAL")return "TERMINAL"
            if(old.phase=="OWNED")return "OWNED"
            if(now<old.retryAt)return if(old.phase=="RETRY")"BACKOFF" else "DUPLICATE"
        }
        entries[id]=Entry("RECEIVED",old?.expires?:now+60000,now+15000)
        return "DISPATCH"
    }
    @Synchronized fun validating(id:String){entries[id]?.phase="VALIDATING"}
    @Synchronized fun owned(id:String){entries[id]?.phase="OWNED"}
    @Synchronized fun terminal(id:String,now:Long){entries[id]=Entry("TERMINAL",now+60000)}
    @Synchronized fun retry(id:String,now:Long){entries[id]?.let{it.phase="RETRY";it.retryAt=now+2500}}
}

internal object ConnectCallCleanup {
    fun run(actions:List<Pair<String,()->Unit>>):List<String> {
        val failed=mutableListOf<String>()
        for((name,action)in actions)try{action()}catch(_:Exception){failed.add(name)}
        return failed
    }
}

internal object ConnectCallValidation {
    fun reason(owner:String,callee:String,status:String,window:ConnectCallTiming.Window?,sameAccount:Boolean,terminal:Boolean):String=when{
        !sameAccount->"AUTH_CHANGED"
        owner.isEmpty()->"NO_SESSION"
        callee.isEmpty()->"NOT_FOUND_OR_FORBIDDEN"
        callee!=owner->"WRONG_OWNER"
        status!="ringing"->"SERVER_"+status.uppercase().take(20)
        terminal->"LOCAL_TERMINAL"
        window?.valid!=true->window?.reason?:"INVALID_TIMESTAMP"
        else->"VALID"
    }
    fun failure(status:Int?,hasSession:Boolean,network:Boolean)=when{
        status==401->"AUTH_401";status==403->"AUTH_403";status!=null->"HTTP_$status"
        !hasSession->"NO_SESSION";network->"NETWORK_RETRY";else->"VALIDATION_EXCEPTION"
    }
}
