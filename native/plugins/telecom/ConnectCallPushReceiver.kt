package com.connect.messenger

import android.content.Context
import android.content.Intent
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver

/** Calls never wait for React/Headless JS. Messages keep the existing RN Firebase path. */
class ConnectCallPushReceiver : ReactNativeFirebaseMessagingReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val kind = intent.getStringExtra("kind")
        val id = intent.getStringExtra("callId") ?: ""
        if (kind in listOf("incoming-call", "call-ended") && id.matches(Regex("[0-9a-fA-F-]{36}")) && ConnectCallSession.hasSession(context)) {
            ConnectCallService.action(context, if (kind == "incoming-call") "incoming" else "remote-end", id)
            return
        }
        // One-time upgrade path: the old Expo-encrypted session is migrated by
        // the existing headless bootstrap, then handed to the same native owner.
        super.onReceive(context, intent)
    }
}
