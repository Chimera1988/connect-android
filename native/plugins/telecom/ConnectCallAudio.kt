package com.connect.messenger

import android.app.NotificationManager
import android.content.Context
import android.media.*
import android.net.Uri
import android.os.*
import android.provider.Settings

/** Sole signal owner. Call notifications are always silent; Telecom never rings. */
internal class ConnectCallAudio(private val context: Context, private val onFocusChange: (Boolean, Boolean) -> Unit) {
    private val manager = context.getSystemService(AudioManager::class.java)
    private var ring: Ringtone? = null
    private var tone: AudioTrack? = null
    private var vibrator: Vibrator? = null
    private var focus: AudioFocusRequest? = null
    private var ringing = false
    private var proximity: PowerManager.WakeLock? = null
    private fun attributes(usage: Int) = AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    fun stopSignals() {
        ringing = false
        try { ring?.stop() } catch (_: Exception) {}; ring = null
        try { vibrator?.cancel() } catch (_: Exception) {}; vibrator = null
        val previous = tone; tone = null
        try { previous?.pause(); previous?.flush(); previous?.release() } catch (_: Exception) {}
    }
    private fun dndAllowsRing(): Boolean {
        val notifications = context.getSystemService(NotificationManager::class.java)
        return when (notifications.currentInterruptionFilter) {
            NotificationManager.INTERRUPTION_FILTER_ALL -> true
            NotificationManager.INTERRUPTION_FILTER_PRIORITY -> try {
                val policy = notifications.notificationPolicy
                policy.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_CALLS != 0 && policy.priorityCallSenders == NotificationManager.Policy.PRIORITY_SENDERS_ANY
            } catch (_: Exception) { false }
            else -> false
        }
    }
    fun incoming() {
        if (ringing) return
        stopSignals(); ringing = true
        val prefs = context.getSharedPreferences("connect_call_settings", 0)
        val notifications = context.getSystemService(NotificationManager::class.java)
        if (!notifications.areNotificationsEnabled() || notifications.getNotificationChannel(ConnectCallService.CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE || !dndAllowsRing()) return
        if (manager.ringerMode == AudioManager.RINGER_MODE_SILENT) return
        if (prefs.getBoolean("vibrate", true) && (manager.ringerMode == AudioManager.RINGER_MODE_VIBRATE || Settings.System.getInt(context.contentResolver, "vibrate_when_ringing", 1) != 0)) {
            val motor = context.getSystemService(Vibrator::class.java)
            if (motor?.hasVibrator() == true) {
                vibrator = motor
                motor.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 450, 850), 0), attributes(AudioAttributes.USAGE_NOTIFICATION_RINGTONE))
            }
        }
        if (prefs.getBoolean("silent", false) || manager.ringerMode != AudioManager.RINGER_MODE_NORMAL || manager.getStreamVolume(AudioManager.STREAM_RING) == 0) return
        val own = prefs.getString("uri", null)?.takeIf { it.startsWith("content://media/") }?.let(Uri::parse)
        // Resolve the real current phone setting on every call, not a frozen channel URI.
        val system = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
        val settingsProxy=if(system!=null)RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) else null
        for (uri in listOfNotNull(own, settingsProxy, system).distinct()) {
            try {
                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { } ?: continue
                val sound = RingtoneManager.getRingtone(context, uri) ?: continue
                sound.audioAttributes = attributes(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                sound.isLooping = true; sound.play(); ring = sound; return
            } catch (_: Exception) { android.util.Log.w("ConnectCall", "RING_URI_UNAVAILABLE") }
        }
        // A silent/unavailable system ringtone must not fall back to a message tone.
        android.util.Log.w("ConnectCall", "RING_UNAVAILABLE")
    }
    fun communication() {
        stopSignals()
        if (focus == null) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener { change ->
                    when(change){
                        AudioManager.AUDIOFOCUS_GAIN -> onFocusChange(true,false)
                        AudioManager.AUDIOFOCUS_LOSS -> onFocusChange(false,true)
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {stopSignals();onFocusChange(false,false)}
                    }
                }.build()
            check(manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Аудиоустройство занято другим вызовом" }
            focus = request
        }
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
    }
    fun signal(connected: Boolean) {
        stopSignals()
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
    fun release() {
        stopSignals(); route(0, false)
        if (focus != null) {
            try { focus?.let { manager.abandonAudioFocusRequest(it) } } catch (_: Exception) {} finally { focus = null }
            try { if (manager.mode == AudioManager.MODE_IN_COMMUNICATION) manager.mode = AudioManager.MODE_NORMAL } catch (_: Exception) {}
        }
    }
}
