package com.connect.messenger

import android.os.Handler
import android.os.Looper

/** A dispatch is not a successful dial. No React dependencies in the service. */
internal object ConnectCallOperations {
    private val handler = Handler(Looper.getMainLooper())
    private val pending = mutableMapOf<String, (String?, String?) -> Unit>()
    @Synchronized fun await(id: String, timeout: () -> Unit, done: (String?, String?) -> Unit): Boolean {
        if (pending.containsKey(id)) return false
        pending[id] = done
        handler.postDelayed({ if (complete(id, null, "Подготовка вызова превысила время ожидания")) timeout() }, 28000)
        return true
    }
    @Synchronized fun complete(id: String, serverId: String?, error: String?): Boolean {
        val done = pending.remove(id) ?: return false
        done(serverId, error)
        return true
    }
}
