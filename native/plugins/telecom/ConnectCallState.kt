package com.connect.messenger

/** Protocol-independent runtime facts. Server 'active' means answered, not audio-ready. */
internal class ConnectCallState {
    enum class Phase { IDLE, PREPARING, OFFER_CREATED, REMOTE_RINGING, PRESENTING, INCOMING, ANSWERING, CONNECTING, ACTIVE, RECONNECTING, ENDED, DECLINED, MISSED, BUSY, FAILED, CANCELLED, NO_ANSWER }
    @Volatile var phase = Phase.IDLE; private set
    @Volatile var revision = 0; private set
    @Volatile var id = ""; private set
    var connected = false; private set
    var remoteAudio = false; private set
    var connectedOnce = false; private set
    private var submittedAnswer: String? = null
    fun submitAnswer(sdp: String) { check(submittedAnswer == null || submittedAnswer == sdp); submittedAnswer = sdp }
    fun answerFingerprint():String? = submittedAnswer?.let{value -> java.security.MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}}
    fun ownsAnswer(sdp: String?) = submittedAnswer != null && submittedAnswer == sdp
    fun begin(callId: String, incoming: Boolean): Int {
        check(phase == Phase.IDLE || terminal())
        revision++; id = callId; connected = false; remoteAudio = false; connectedOnce = false
        submittedAnswer = null
        phase = if (incoming) Phase.INCOMING else Phase.PREPARING
        return revision
    }
    fun valid(token: Int) = token == revision && !terminal() && phase != Phase.IDLE
    fun terminal() = phase in setOf(Phase.ENDED, Phase.DECLINED, Phase.MISSED, Phase.BUSY, Phase.FAILED, Phase.CANCELLED, Phase.NO_ANSWER)
    fun offered() { check(phase==Phase.PREPARING){"INVALID_TRANSITION_${phase}_TO_OFFER_CREATED"};phase=Phase.OFFER_CREATED }
    fun identified(callId: String) { check(phase==Phase.OFFER_CREATED){"INVALID_TRANSITION_${phase}_TO_REMOTE_RINGING"}; id = callId; phase = Phase.REMOTE_RINGING }
    fun presenting() {check(phase==Phase.INCOMING);phase=Phase.PRESENTING}
    fun ringing() {check(phase==Phase.PRESENTING);phase=Phase.INCOMING}
    fun answering() {check(phase==Phase.INCOMING);phase=Phase.ANSWERING}
    fun answered() { check(phase in setOf(Phase.INCOMING,Phase.ANSWERING,Phase.REMOTE_RINGING,Phase.CONNECTING,Phase.ACTIVE,Phase.RECONNECTING));if(phase!=Phase.ACTIVE&&phase!=Phase.RECONNECTING)phase=Phase.CONNECTING }
    fun transport(ready: Boolean) {
        if (terminal()) return
        connected = ready
        if (!ready && connectedOnce) phase = Phase.RECONNECTING
        updateReady()
    }
    fun audio(ready: Boolean) { if (!terminal()) { remoteAudio = ready; if (!ready && connectedOnce) phase = Phase.RECONNECTING; updateReady() } }
    private fun updateReady() {
        if (connected && remoteAudio && phase in setOf(Phase.CONNECTING, Phase.RECONNECTING)) {
            connectedOnce = true; phase = Phase.ACTIVE
        }
    }
    fun end(result: Phase): Boolean {
        require(result in setOf(Phase.ENDED, Phase.DECLINED, Phase.MISSED, Phase.BUSY, Phase.FAILED, Phase.CANCELLED, Phase.NO_ANSWER))
        if (terminal() || phase == Phase.IDLE) return false
        phase = result; revision++; connected = false; remoteAudio = false
        submittedAnswer = null
        return true
    }
    companion object {
        fun validIncoming(owner: String, callee: String, status: String, created: Long, now: Long, expectedEpoch:Int=0,currentEpoch:Int=0) =
            expectedEpoch==currentEpoch && owner.isNotEmpty() && owner == callee && status == "ringing" && created > 0 && now - created < 60000 && created <= now + 10000
        fun allowStart(action:String, live:Boolean, terminalId:Boolean):Boolean {
            if(action in listOf("incoming","dial")&&terminalId)return false
            if(action in listOf("sync","remote-end","answer","decline","end","mute","speaker","route","failed","bridge-timeout","preparation-timeout")&&!live)return false
            return true
        }
    }
}

/** Original Connect/PWA frequencies and envelopes; no third-party sound assets. */
internal object ConnectCallPcm {
    const val RATE = 16000
    fun samples(connected: Boolean): ShortArray {
        val result = ShortArray(if (connected) RATE * 31 / 100 else RATE * 36 / 10)
        fun tone(hz: Double, start: Double, duration: Double, amplitude: Double) {
            val first = (start * RATE).toInt(); val count = (duration * RATE).toInt()
            for (i in 0 until count) {
                val envelope = minOf(1.0, i / (RATE * .006), (count - i) / (RATE * .02))
                val value = kotlin.math.sin(2 * Math.PI * hz * i / RATE) * amplitude * envelope * 32767
                result[first + i] = (result[first + i] + value.toInt()).coerceIn(-32768, 32767).toShort()
            }
        }
        if (connected) { tone(740.0, 0.0, .12, .055); tone(988.0, .12, .19, .060) }
        else for (start in listOf(0.0, .64)) { tone(440.0, start, .45, .046); tone(480.0, start, .45, .037) }
        return result
    }
}
