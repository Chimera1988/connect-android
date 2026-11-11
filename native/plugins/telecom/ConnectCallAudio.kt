package com.connect.messenger

import android.app.NotificationManager
import android.content.Context
import android.media.*
import android.net.Uri
import android.os.*
import android.provider.Settings

/** Sole incoming signal owner, independent of Telecom conversation focus. */
internal class ConnectCallAudio(private val context:Context,private val onRingWarning:()->Unit={}) {
    private val manager=context.getSystemService(AudioManager::class.java)
    private val handler=Handler(Looper.getMainLooper())
    private var ring:MediaPlayer?=null
    private var tone:AudioTrack?=null
    private var vibrator:Vibrator?=null
    private val lease=ConnectRingLease()
    private val ringing get()=lease.running
    private val generation get()=lease.generation
    private var alertId=""
    private var proximity:PowerManager.WakeLock?=null
    private fun attributes(usage:Int)=AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    private fun log(stage:String,state:String,code:String="",details:Map<String,Any> = emptyMap())=ConnectCallDiagnostics.event(context,alertId.ifEmpty{ConnectCallService.snapshot().optString("callId")},stage,state,code,details)
    private fun releaseRing(){val player=ring;ring=null;try{player?.setOnPreparedListener(null);player?.setOnErrorListener(null);player?.release()}catch(_:Exception){}}
    fun stopIncoming(reason:String){
        if(ringing||ring!=null||vibrator!=null)log("signals","stopped",reason)
        lease.stop()
        releaseRing()
        val motor=vibrator;vibrator=null
        try{motor?.cancel();if(motor!=null)log("vibration","STOPPED",reason)}catch(_:Exception){log("vibration","STOP_FAILED",reason)}
    }
    fun stopTone(reason:String){
        val player=tone;tone=null
        try{player?.pause();player?.flush();player?.release();if(player!=null)log("tone","STOPPED",reason)}catch(_:Exception){}
    }
    fun stopSignals(reason:String="CALL_STATE_CHANGED"){stopIncoming(reason);stopTone(reason)}
    private fun dndAllowsRing():Boolean{
        val notifications=context.getSystemService(NotificationManager::class.java)
        return when(notifications.currentInterruptionFilter){
            NotificationManager.INTERRUPTION_FILTER_ALL->true
            NotificationManager.INTERRUPTION_FILTER_PRIORITY->try{
                val p=notifications.notificationPolicy
                p.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_CALLS!=0&&p.priorityCallSenders==NotificationManager.Policy.PRIORITY_SENDERS_ANY
            }catch(_:Exception){false}
            else->false
        }
    }
    private fun systemSetting(name:String):Int?=try{Settings.System.getString(context.contentResolver,name)?.toIntOrNull()}catch(_:Exception){null}
    fun vibrationPolicy():String{
        val motor=if(Build.VERSION.SDK_INT>=31)context.getSystemService(VibratorManager::class.java)?.defaultVibrator else context.getSystemService(Vibrator::class.java)
        return ConnectCallAlertPolicy.vibration(Build.VERSION.SDK_INT,context.getSharedPreferences("connect_call_settings",0).getBoolean("callVibrationV2",true),manager.ringerMode,motor?.hasVibrator()==true,if(Build.VERSION.SDK_INT<=30)systemSetting("vibrate_when_ringing")else null,if(Build.VERSION.SDK_INT>=31)systemSetting("ring_vibration_intensity")else null)
    }
    fun incoming(){
        if(ringing){log("signals","UNCHANGED","ALREADY_RINGING");return}
        stopSignals("INCOMING_STARTED");lease.start();alertId=ConnectCallService.snapshot().optString("callId")
        val notifications=context.getSystemService(NotificationManager::class.java)
        val blocked=when{
            !notifications.areNotificationsEnabled()->"NOTIFICATIONS_DISABLED"
            notifications.getNotificationChannel(ConnectCallService.CHANNEL)?.importance==NotificationManager.IMPORTANCE_NONE->"CHANNEL_DISABLED"
            !dndAllowsRing()->"DND"
            manager.ringerMode==AudioManager.RINGER_MODE_SILENT->"RINGER_SILENT"
            else->null
        }
        if(blocked!=null){log("ringtone","SUPPRESSED",blocked);log("vibration","SUPPRESSED",blocked);return}
        // Vibration failure must never prevent the independent ring player from starting.
        val policy=vibrationPolicy()
        if(policy=="ALLOWED_SYSTEM_POLICY")try{
            val motor=if(Build.VERSION.SDK_INT>=31)context.getSystemService(VibratorManager::class.java).defaultVibrator else context.getSystemService(Vibrator::class.java)
            vibrator=motor
            val effect=VibrationEffect.createWaveform(longArrayOf(0,450,850),0)
            if(Build.VERSION.SDK_INT>=33)motor.vibrate(effect,VibrationAttributes.Builder().setUsage(VibrationAttributes.USAGE_RINGTONE).build())
            else motor.vibrate(effect,attributes(AudioAttributes.USAGE_NOTIFICATION_RINGTONE))
            log("vibration","PATTERN_REQUESTED",policy)
            // Android has no public acknowledgement of physical motor movement.
        }catch(error:Exception){log("vibration","FAILED",if(error is SecurityException)"VIBRATE_PERMISSION" else "VIBRATOR_ERROR")}
        else log("vibration","SUPPRESSED",policy)
        val prefs=context.getSharedPreferences("connect_call_settings",0)
        val silent=when{
            prefs.getBoolean("silent",false)->"CONNECT_SOUND_MUTED"
            manager.ringerMode!=AudioManager.RINGER_MODE_NORMAL->"VIBRATE_MODE"
            manager.getStreamVolume(AudioManager.STREAM_RING)==0->"RING_VOLUME_ZERO"
            else->null
        }
        if(silent!=null){log("ringtone","SUPPRESSED",silent);return}
        val custom=prefs.getString("uri",null)?.takeIf{it.isNotBlank()}
        val bundled=Uri.parse("android.resource://${context.packageName}/raw/connect_call")
        val choices=if(custom!=null)listOf(Uri.parse(custom),bundled)else listOf(bundled)
        val token=generation
        fun warning(){prefs.edit().putString("ringWarning","CUSTOM_UNAVAILABLE").apply();onRingWarning()}
        fun play(index:Int){
            if(!ringing||token!=generation)return
            if(index>=choices.size){log("ringtone","FAILED","RING_UNAVAILABLE");return}
            val uri=choices[index];val own=uri!=bundled
            var candidate:MediaPlayer?=null
            fun fail(code:String){
                if(!ringing||generation!=token)return
                if(candidate!=null&&ring!==candidate)return
                log("ringtone","FAILED",code, mapOf("source" to if(own)"CUSTOM" else "CONNECT_CALL"))
                releaseRing();if(own){warning();log("ringtone","FALLBACK_REQUESTED","CONNECT_CALL")};play(index+1)
            }
            try{
                if(own&&!uri.toString().startsWith("content://media/")){fail("CUSTOM_URI_INVALID");return}
                context.contentResolver.openAssetFileDescriptor(uri,"r")?.use{}?:throw java.io.FileNotFoundException()
                val player=MediaPlayer();candidate=player;ring=player
                player.setAudioAttributes(attributes(AudioAttributes.USAGE_NOTIFICATION_RINGTONE))
                player.setOnErrorListener{_,what,extra->fail("PLAYER_ERROR_${what}_${extra}");true}
                player.setOnPreparedListener{
                    if(!ringing||generation!=token||ring!==player)return@setOnPreparedListener
                    try{
                        player.isLooping=true;player.start();log("ringtone",if(player.isPlaying)"PLAYING" else "NOT_PLAYING",if(own)"CUSTOM" else "CONNECT_CALL")
                        if(!player.isPlaying){fail("PLAYER_NOT_PLAYING");return@setOnPreparedListener}
                        if(own||custom==null){prefs.edit().remove("ringWarning").apply();onRingWarning()}
                    }catch(_:Exception){fail("PLAYER_START_FAILED")}
                }
                player.setDataSource(context,uri)
                log("ringtone","PLAY_REQUESTED",if(own)"CUSTOM" else "CONNECT_CALL")
                player.prepareAsync()
                handler.postDelayed({if(ringing&&generation==token&&ring===player)try{if(!player.isPlaying)fail("PLAYER_PREPARE_TIMEOUT")}catch(_:Exception){fail("PLAYER_STATE_ERROR")}},3000)
            }catch(error:Exception){fail(when(error){is SecurityException->"URI_ACCESS_DENIED";is java.io.FileNotFoundException->"URI_NOT_FOUND";else->"PLAYER_CREATE_FAILED"})}
        }
        play(0)
    }
    fun communication(){stopSignals("ANSWER_WEBRTC_PREPARE")}
    fun signal(connected: Boolean) {
        stopSignals(if(connected)"CONNECTED_CHIME" else "OUTGOING_RINGBACK")
        val samples = ConnectCallPcm.samples(connected)
        val player = AudioTrack.Builder().setAudioAttributes(attributes(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING))
            .setAudioFormat(AudioFormat.Builder().setSampleRate(ConnectCallPcm.RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.size * 2).build()
        check(player.write(samples, 0, samples.size) == samples.size)
        tone = player
        if (!connected) player.setLoopPoints(0, samples.size, -1)
        else {
            player.notificationMarkerPosition = samples.size
            player.setPlaybackPositionUpdateListener(object : AudioTrack.OnPlaybackPositionUpdateListener {
                override fun onMarkerReached(track: AudioTrack) { if (tone === track) { tone = null; track.release() } }
                override fun onPeriodicNotification(track: AudioTrack) {}
            }, Handler(Looper.getMainLooper()))
        }
        player.play()
    }
    fun route(route: Int, active: Boolean) {
        if (active && route == android.telecom.CallAudioState.ROUTE_EARPIECE) {
            val power = context.getSystemService(PowerManager::class.java)
            if (proximity?.isHeld != true && power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                if(proximity==null)proximity=power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "Connect:call-proximity")
                proximity?.acquire(10 * 60 * 1000L)
            }
        } else { try { proximity?.release() } catch (_: Exception) {}; proximity = null }
    }
    fun release(reason:String="CALL_CLEANUP") {
        stopSignals(reason); route(0, false)
    }
}
