package com.connect.messenger

/** The UI session survives replacement of the client operation UUID by the server UUID. */
internal object ConnectCallPresentation {
    fun accepts(callId: String, presentationId: String, eventId: String, eventPresentation: String): Boolean =
        callId.isNotEmpty() && (callId == eventId ||
            presentationId.isNotEmpty() && presentationId == eventPresentation)
}

internal class ConnectCallMediaEvidence {
    var inbound = false; private set
    var outbound = false; private set
    val ready get() = inbound && outbound
    fun observe(kind: String, packets: Long) {
        if (packets <= 0) return
        if (kind == "inbound-rtp") inbound = true
        if (kind == "outbound-rtp") outbound = true
    }
    fun reset() { inbound = false; outbound = false }
}

/** Arrival TTL is never renewed by redelivery; server TTL is checked separately. */
internal object ConnectCallHintPolicy {
    fun accepts(expires:Long,boundOwner:String,owner:String,now:Long)=
        expires>now&&(boundOwner.isEmpty()||owner.isEmpty()||boundOwner==owner)
}
