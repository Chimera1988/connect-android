package com.connect.messenger

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.telecom.*

/** One native self-managed Telecom connection; never creates its own ringtone. */
class ConnectCallConnectionService : ConnectionService() {
    companion object {
        private fun callId(request:ConnectionRequest):String = request.extras?.getString("connectCallId") ?: request.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)?.getString("connectCallId") ?: request.extras?.getBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)?.getString("connectCallId") ?: ""
        private val connections = java.util.concurrent.ConcurrentHashMap<String, Connection>()
        @Volatile private var hasFocus = false
        private val answered = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        fun account(c: Context): PhoneAccountHandle {
            val handle = PhoneAccountHandle(ComponentName(c, ConnectCallConnectionService::class.java), "connect-audio")
            c.getSystemService(TelecomManager::class.java).registerPhoneAccount(PhoneAccount.builder(handle, "Connect")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED).addSupportedUriScheme(PhoneAccount.SCHEME_SIP).build())
            return handle
        }
        fun get(id: String) = connections[id]
        // Telecom's ACTIVE means the user answered, not that RTP is flowing.
        fun answered(id: String) { answered.add(id); connections[id]?.setActive() }
        fun close(id: String, reason: Int) { answered.remove(id); connections.remove(id)?.apply { setDisconnected(DisconnectCause(reason)); destroy() } }
    }
    override fun onConnectionServiceFocusGained() {
        hasFocus = true
        connections.keys.forEach { ConnectCallService.telecomFocus(it,true) }
    }
    override fun onConnectionServiceFocusLost() {
        hasFocus = false
        val ids = connections.keys.toList()
        if(ids.isEmpty()) connectionServiceFocusReleased()
        else ids.forEach { ConnectCallService.telecomFocus(it,false) { connectionServiceFocusReleased() } }
    }
    private fun create(request: ConnectionRequest, incoming: Boolean): Connection {
        val id = callId(request)
        if (id.isEmpty() || !ConnectCallService.owns(id)) return Connection.createFailedConnection(DisconnectCause(DisconnectCause.CANCELED))
        val connection = object : Connection() {
            override fun onAnswer() { ConnectCallService.action(this@ConnectCallConnectionService, "answer", id) }
            override fun onAnswer(videoState: Int) { onAnswer() }
            override fun onReject() { ConnectCallService.action(this@ConnectCallConnectionService, "decline", id) }
            override fun onDisconnect() { ConnectCallService.action(this@ConnectCallConnectionService, "end", id) }
            override fun onAbort() { onDisconnect() }
            override fun onCallAudioStateChanged(state: CallAudioState) { ConnectCallService.audioState(id, state) }
            override fun onShowIncomingCallUi() { ConnectCallService.showIncomingUi(id) }
            override fun onSilence() { ConnectCallService.silenceIncoming(id) }
        }
        connection.connectionProperties = Connection.PROPERTY_SELF_MANAGED
        connection.connectionCapabilities = Connection.CAPABILITY_MUTE
        connection.setAudioModeIsVoip(true)
        connection.setAddress(Uri.fromParts("sip", id, null), TelecomManager.PRESENTATION_RESTRICTED)
        connection.setCallerDisplayName(request.extras?.getString("connectName") ?: "Connect", TelecomManager.PRESENTATION_ALLOWED)
        connections[id] = connection
        ConnectCallDiagnostics.event(this,id,"telecom",if(incoming)"INCOMING_CONNECTION_CREATED" else "OUTGOING_CONNECTION_CREATED")
        if (answered.contains(id) || ConnectCallService.snapshot().optString("phase") in listOf("active","connecting","reconnecting")) connection.setActive()
        else if (incoming) connection.setRinging() else connection.setDialing()
        ConnectCallService.telecomFocus(id,hasFocus)
        return connection
    }
    override fun onCreateIncomingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest) = create(request, true)
    override fun onCreateOutgoingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest) = create(request, false)
    override fun onCreateIncomingConnectionFailed(handle: PhoneAccountHandle?, request: ConnectionRequest) { ConnectCallDiagnostics.event(this,callId(request),"telecom","CONNECTION_FAILED");ConnectCallService.telecomFailed(callId(request)) }
    override fun onCreateOutgoingConnectionFailed(handle: PhoneAccountHandle?, request: ConnectionRequest) { ConnectCallDiagnostics.event(this,callId(request),"telecom","CONNECTION_FAILED");ConnectCallService.telecomFailed(callId(request)) }
}
