package com.connect.messenger

import android.content.Context
import android.content.Intent
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver

/** Calls never wait for React/Headless JS. Messages keep the existing RN Firebase path. */
class ConnectCallPushReceiver : ReactNativeFirebaseMessagingReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if(ConnectMissedCalls.receive(context,listOf("kind","callId","conversationId","userId","endedAt","title","body").mapNotNull{key->intent.getStringExtra(key)?.let{key to it}}.toMap()))return
        val kind = intent.getStringExtra("kind")
        val id = intent.getStringExtra("callId") ?: ""
        if (ConnectCallIngress.receive(context,kind,id)) return
        // One-time upgrade path: the old Expo-encrypted session is migrated by
        // the existing headless bootstrap, then handed to the same native owner.
        super.onReceive(context, intent)
    }
}
