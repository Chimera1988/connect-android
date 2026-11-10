package com.connect.messenger

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.telecom.*

/** One native self-managed Telecom connection; never creates its own ringtone. */
class ConnectCallConnectionService : ConnectionService() {
    companion object {
        private val connections = java.util.concurrent.ConcurrentHashMap<String, Connection>()
        fun account(c: Context): PhoneAccountHandle {
            val handle = PhoneAccountHandle(ComponentName(c, ConnectCallConnectionService::class.java), "connect-audio")
            c.getSystemService(TelecomManager::class.java).registerPhoneAccount(PhoneAccount.builder(handle, "Connect")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED).addSupportedUriScheme(PhoneAccount.SCHEME_SIP).build())
            return handle
        }
        fun get(id: String) = connections[id]
        fun close(id: String, reason: Int) { connections.remove(id)?.apply { setDisconnected(DisconnectCause(reason)); destroy() } }
    }
    private fun create(request: ConnectionRequest, incoming: Boolean): Connection {
        val id = request.extras?.getString("connectCallId") ?: request.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)?.getString("connectCallId") ?: request.extras?.getBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)?.getString("connectCallId") ?: ""
        if (id.isEmpty() || !ConnectCallService.owns(id)) return Connection.createFailedConnection(DisconnectCause(DisconnectCause.CANCELED))
        val connection = object : Connection() {
            override fun onAnswer() { ConnectCallService.action(this@ConnectCallConnectionService, "answer", id) }
            override fun onAnswer(videoState: Int) { onAnswer() }
            override fun onReject() { ConnectCallService.action(this@ConnectCallConnectionService, "decline", id) }
            override fun onDisconnect() { ConnectCallService.action(this@ConnectCallConnectionService, "end", id) }
            override fun onAbort() { onDisconnect() }
            override fun onCallAudioStateChanged(state: CallAudioState) { ConnectCallService.audioState(id, state) }
            override fun onShowIncomingCallUi() { /* The service's CallStyle notification owns presentation. */ }
        }
        connection.connectionProperties = Connection.PROPERTY_SELF_MANAGED
        connection.connectionCapabilities = Connection.CAPABILITY_MUTE
        connection.setAudioModeIsVoip(true)
        connection.setAddress(Uri.fromParts("sip", id, null), TelecomManager.PRESENTATION_RESTRICTED)
        connection.setCallerDisplayName(request.extras?.getString("connectName") ?: "Connect", TelecomManager.PRESENTATION_ALLOWED)
        connections[id] = connection
        if (ConnectCallService.snapshot().optString("phase") == "active") connection.setActive()
        else if (incoming) connection.setRinging() else connection.setDialing()
        return connection
    }
    override fun onCreateIncomingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest) = create(request, true)
    override fun onCreateOutgoingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest) = create(request, false)
    override fun onCreateIncomingConnectionFailed(handle: PhoneAccountHandle?, request: ConnectionRequest) { ConnectCallService.telecomFailed(request.extras?.getString("connectCallId") ?: "") }
    override fun onCreateOutgoingConnectionFailed(handle: PhoneAccountHandle?, request: ConnectionRequest) { ConnectCallService.telecomFailed(request.extras?.getString("connectCallId") ?: "") }
}
