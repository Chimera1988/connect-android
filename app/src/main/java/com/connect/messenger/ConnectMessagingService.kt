package com.connect.messenger

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Firebase messages use data-only payloads to avoid duplicate system notifications. */
class ConnectMessagingService : FirebaseMessagingService() {
    private fun timestamp(value: String): Long = try {
        java.time.OffsetDateTime.parse(value).toInstant().toEpochMilli()
    } catch (_: Exception) { -1L }
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // A refreshed token is sent with the authenticated session from the web shell.
        getSharedPreferences("connect_push", MODE_PRIVATE).edit()
            .putBoolean("fcm_token_changed", true).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val prefs = ConnectNotifications.preferences(this)
        if (message.data["kind"] == "read") {
            val id = message.data["conversationId"] ?: return
            val at = message.data["readAt"] ?: return
            if (!id.matches(Regex("[0-9a-fA-F-]{36}")) || at.isBlank()) return
            val previous = prefs.getString("read_at_$id", "") ?: ""
            val readTime = timestamp(at)
            if (readTime < 0L) return
            if (readTime > timestamp(previous)) prefs.edit().putString("read_at_$id", at).apply()
            val newest = prefs.getString("notification_at_$id", "") ?: ""
            if (timestamp(newest) >= 0L && timestamp(newest) <= readTime)
                ConnectNotifications.dismissChat(this, id)
            return
        }
        if (!prefs.getBoolean("enabled", true)) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val data = message.data
        if (data["kind"] == "incoming-call") showCall(data)
        else showMessage(data)
    }

    private fun openApp(action: String, callId: String?, conversationId: String?, code: Int): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (callId != null) {
                putExtra("connect_call_action", action)
                putExtra("connect_call_id", callId)
            }
            if (conversationId != null) putExtra("connect_chat_id", conversationId)
        }
        return PendingIntent.getActivity(this, code, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun showMessage(data: Map<String, String>) {
        val conversationId = data["conversationId"]?.takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) } ?: return
        val createdAt = data["createdAt"] ?: ""
        val readAt = ConnectNotifications.preferences(this).getString("read_at_$conversationId", "") ?: ""
        if (timestamp(createdAt) >= 0L && timestamp(readAt) >= timestamp(createdAt)) return
        if (ConnectAppPresence.visible && ConnectAppPresence.activeConversation == conversationId) return
        val pending = openApp("open", null, conversationId, conversationId.hashCode())
        val notification = NotificationCompat.Builder(this, ConnectNotifications.channel(this, "message"))
            .setSmallIcon(R.drawable.connect_icon)
            .setContentTitle(data["title"]?.take(90) ?: "Connect")
            .setContentText("Новое сообщение")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSilent(ConnectNotifications.isSilent(this, "message"))
            .setGroup("connect-messages")
            .build()
        // One notification per chat: multiple new messages update, rather than pile up.
        if (createdAt.isNotBlank()) ConnectNotifications.preferences(this).edit()
            .putString("notification_at_$conversationId", createdAt).apply()
        ConnectNotifications.manager(this).notify("chat:$conversationId", ConnectNotifications.MESSAGE_ID, notification)
    }

    private fun showCall(data: Map<String, String>) {
        val callId = data["callId"]?.takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) } ?: return
        val conversationId = data["conversationId"]
        val caller = data["body"]?.take(120) ?: "Собеседник"
        val request = callId.hashCode()
        val open = openApp("open", callId, conversationId, request)
        val answer = openApp("accept", callId, conversationId, request xor 0x1212)
        val decline = openApp("decline", callId, conversationId, request xor 0x3434)
        // Important: Android must open the dedicated lock-screen Activity, not the WebView.
        val fullScreenIntent = Intent(this, IncomingCallActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("connect_call_id", callId)
            putExtra("connect_caller_name", caller)
            if (!conversationId.isNullOrBlank()) putExtra("connect_chat_id", conversationId)
        }
        val fullScreen = PendingIntent.getActivity(
            this, request xor 0x5151, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val person = Person.Builder().setName(caller).build()
        val notification = NotificationCompat.Builder(this, ConnectNotifications.channel(this, "call"))
            .setSmallIcon(R.drawable.connect_icon)
            .setContentTitle("Входящий аудиозвонок · Connect")
            .setContentText(caller)
            .setContentIntent(open)
            .setFullScreenIntent(fullScreen, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setSilent(ConnectNotifications.isSilent(this, "call"))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOngoing(true)
            .setTimeoutAfter(65_000)
            .build()
        ConnectNotifications.manager(this).notify("call:$callId", ConnectNotifications.CALL_ID, notification)
    }
}
