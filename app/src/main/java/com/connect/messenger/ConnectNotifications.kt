package com.connect.messenger

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.net.Uri
import android.provider.Settings

object ConnectNotifications {
    const val MESSAGE_ID = 2001
    const val CALL_ID = 2002
    const val SOUND_AUTHORITY = "com.connect.messenger.sounds"

    fun manager(context: Context): NotificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun preferences(context: Context): SharedPreferences =
        context.getSharedPreferences("connect_push", Context.MODE_PRIVATE)

    fun customUri(context: Context, kind: String): Uri? {
        val name = preferences(context).getString("custom_$kind", null) ?: return null
        if (!Regex("[a-f0-9-]{36}\\.audio").matches(name)) return null
        if (!java.io.File(context.filesDir, "sounds/$name").isFile) return null
        return Uri.parse("content://$SOUND_AUTHORITY/$name")
    }

    fun isSilent(context: Context, kind: String): Boolean {
        val prefs = preferences(context)
        if (prefs.getBoolean("mute_$kind", false)) return true
        return kind == "message" && customUri(context, kind) == null && prefs.getString("sound", "soft") == "silent"
    }

    /** Android notification channels are immutable. A different sound uses a different ID. */
    fun channel(context: Context, kind: String): String {
        val prefs = preferences(context)
        val custom = customUri(context, kind)
        val builtin = prefs.getString("sound", "soft") ?: "soft"
        val silent = isSilent(context, kind)
        val vibrate = prefs.getBoolean("vibrate", true)
        val sound = custom ?: if (kind == "call") Settings.System.DEFAULT_RINGTONE_URI else {
            val name = if (builtin in setOf("soft", "gentle", "bright")) builtin else "soft"
            Uri.parse("android.resource://${context.packageName}/raw/connect_$name")
        }
        val identifier = when {
            silent -> "silent"
            custom != null -> custom.lastPathSegment ?: "custom"
            kind == "call" -> "system"
            else -> builtin
        }
        val channelId = "connect_${kind}_${identifier}_${if (vibrate) "v" else "s"}_v6"
        val manager = manager(context)
        if (manager.getNotificationChannel(channelId) == null) {
            val isCall = kind == "call"
            val channel = NotificationChannel(channelId,
                if (isCall) "Connect — аудиозвонки" else "Connect — сообщения",
                NotificationManager.IMPORTANCE_HIGH)
            channel.setSound(if (silent) null else sound, AudioAttributes.Builder()
                .setUsage(if (isCall) AudioAttributes.USAGE_NOTIFICATION_RINGTONE else AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            channel.enableVibration(vibrate)
            channel.lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            manager.createNotificationChannel(channel)
        }
        return channelId
    }

    fun dismissChat(context: Context, conversationId: String) {
        if (conversationId.isNotBlank()) manager(context).cancel("chat:$conversationId", MESSAGE_ID)
    }

    fun dismissCall(context: Context, callId: String) {
        if (callId.isNotBlank()) manager(context).cancel("call:$callId", CALL_ID)
    }
}
