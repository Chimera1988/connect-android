package com.connect.messenger

/** The UI session survives replacement of the client operation UUID by the server UUID. */
internal object ConnectCallPresentation {
    fun accepts(callId: String, presentationId: String, eventId: String, eventPresentation: String): Boolean =
        callId.isNotEmpty() && (callId == eventId ||
            presentationId.isNotEmpty() && presentationId == eventPresentation)
}

internal class ConnectCallMediaEvidence {
    private var received = 0L; private var sent = 0L; private var receivedFloor=0L; private var sentFloor=0L
    var inbound = false; private set
    var outbound = false; private set
    val ready get() = inbound && outbound
    fun observe(kind: String, packets: Long) {
        if (packets <= 0) return
        if (kind == "inbound-rtp") {received=maxOf(received,packets);inbound=packets>receivedFloor}
        if (kind == "outbound-rtp") {sent=maxOf(sent,packets);outbound=packets>sentFloor}
    }
    fun pause() {receivedFloor=received;sentFloor=sent;inbound=false;outbound=false}
    fun reset() {received=0;sent=0;receivedFloor=0;sentFloor=0;inbound = false; outbound = false }
}

/** Arrival TTL is never renewed by redelivery; server TTL is checked separately. */
internal object ConnectCallHintPolicy {
    fun accepts(expires:Long,boundOwner:String,owner:String,now:Long)=
        expires>now&&(boundOwner.isEmpty()||owner.isEmpty()||boundOwner==owner)
}
