package com.connect.messenger

/** Telecom is the only call-focus owner. A transport connection alone is insufficient. */
internal class ConnectCallAudioGate {
    var focus = false; private set
    var remote = false
    var recording = false
    var playout = false
    var rtp = false
    val ready get() = focus && remote && recording && playout && rtp
    fun focus(value: Boolean) { focus = value; if (!value) { recording = false; playout = false; rtp = false } }
    fun reset() { focus(false); remote = false }
}

/** No platform UI dependency; redelivery cannot renew a presentation lease. */
internal class ConnectCallScreenGate {
    private var requestedId = ""
    private var requestedAt = 0L
    fun request(id: String, live: Boolean, visible: Boolean, foreground: Boolean, now: Long): String = when {
        !live || id.isEmpty() -> "NOT_LIVE"
        visible -> "ALREADY_VISIBLE"
        !foreground -> "NOT_FOREGROUND"
        id == requestedId && now - requestedAt < 1500 -> "IN_FLIGHT"
        else -> { requestedId = id; requestedAt = now; "REQUEST" }
    }
    fun clear() { requestedId = ""; requestedAt = 0 }
}

internal class ConnectCallFailure(val stage: String, val code: String, cause: Exception) : RuntimeException(cause)
internal object ConnectCallErrors {
    inline fun <T> at(stage: String, code: String, operation: () -> T): T = try { operation() }
        catch (error: ConnectCallFailure) { throw error }
        catch (error: Exception) { throw ConnectCallFailure(stage, code, error) }
    fun message(stage: String) = when (stage) {
        "sdp" -> "Некорректное описание аудиосоединения"
        "adm-record" -> "Не удалось открыть микрофон"
        "adm-playout", "adm-create" -> "Не удалось подготовить аудиоустройство"
        "network" -> "Не удалось связаться с сервером вызовов"
        "webrtc-init", "webrtc-factory", "webrtc-peer", "webrtc-track" -> "Не удалось подготовить WebRTC-аудиосоединение"
        else -> "Внутренняя ошибка обработки аудиовызова"
    }
    fun reason(result: ConnectCallState.Phase) = when (result) {
        ConnectCallState.Phase.DECLINED -> "decline"
        ConnectCallState.Phase.MISSED, ConnectCallState.Phase.NO_ANSWER -> "missed"
        ConnectCallState.Phase.FAILED -> "failed"
        ConnectCallState.Phase.BUSY -> "busy"
        else -> "hangup"
    }
}
