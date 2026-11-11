package com.connect.messenger

/** One lease per validated incoming call. Bootstrap publication never consumes it. */
internal class ConnectIncomingAlerts {
    private var id = ""
    private var allowed = false
    private var posted = false
    private var signals = false
    fun begin(callId:String) { id=callId;allowed=false;posted=false;signals=false }
    fun authorize(callId:String,ringing:Boolean,remainingMs:Long=Long.MAX_VALUE):Boolean {
        if(callId!=id||!ringing||id.isEmpty()||remainingMs<=0)return false
        allowed=true;return true
    }
    fun canPresent(callId:String)=id.isNotEmpty()&&id==callId&&allowed
    fun first(callId:String)=canPresent(callId)&&!posted
    fun posted(callId:String){check(canPresent(callId));posted=true}
    fun claimSignals(callId:String):Boolean {
        if(!canPresent(callId)||!posted||signals)return false
        signals=true;return true
    }
    fun silence(callId:String){if(callId==id&&id.isNotEmpty())signals=true}
    fun close(){id="";allowed=false;posted=false;signals=false}
}

/** Invalidates late prepare/error callbacks before any following call can ring. */
internal class ConnectRingLease {
    var generation=0; private set
    var running=false; private set
    fun start(){check(!running);generation++;running=true}
    fun stop(){generation++;running=false}
    fun valid(token:Int)=running&&generation==token
}

internal object ConnectCallAlertPolicy {
    fun keepIncomingOnFocusLoss(phase:ConnectCallState.Phase,incoming:Boolean)=incoming&&phase in setOf(ConnectCallState.Phase.PRESENTING,ConnectCallState.Phase.INCOMING)
    /** 0=silent, 1=vibrate, 2=normal (AudioManager constants). Missing OEM keys are not 'off'. */
    fun vibration(sdk:Int,appEnabled:Boolean,mode:Int,hasMotor:Boolean,legacy:Int?,intensity:Int?):String = when {
        !appEnabled -> "CONNECT_VIBRATION_OFF"
        !hasMotor -> "NO_VIBRATOR"
        mode==0 -> "RINGER_SILENT"
        sdk>=31&&intensity==0 -> "SYSTEM_RING_INTENSITY_OFF"
        sdk<=30&&mode==2&&legacy==0 -> "SYSTEM_RING_VIBRATION_OFF"
        else -> "ALLOWED_SYSTEM_POLICY"
    }
}
