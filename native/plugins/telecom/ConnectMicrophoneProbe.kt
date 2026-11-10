package com.connect.messenger

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock

/** Bounded real microphone preflight before a server call/history row exists.
 * Samples are discarded immediately, never logged or persisted. Runs off the UI thread. */
internal object ConnectMicrophoneProbe {
    fun check(context: Context) {
        check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            "Для аудиозвонка разрешите доступ к микрофону в настройках Android"
        }
        val size = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(size > 0) { "Android не поддерживает выбранный режим микрофона" }
        val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(size * 2, 3200))
        try {
            check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Не удалось подготовить микрофон" }
            recorder.startRecording()
            check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Микрофон занят или недоступен" }
            val samples = ShortArray(160)
            val deadline = SystemClock.elapsedRealtime() + 1500
            while (SystemClock.elapsedRealtime() < deadline) {
                val count = recorder.read(samples, 0, samples.size, AudioRecord.READ_NON_BLOCKING)
                samples.fill(0)
                if (count > 0) return
                check(count >= 0) { "Android не может получить звук с микрофона" }
                Thread.sleep(10)
            }
            error("Микрофон не передаёт аудиоданные")
        } finally {
            try { recorder.stop() } catch (_: Exception) {}
            recorder.release()
        }
    }
}
