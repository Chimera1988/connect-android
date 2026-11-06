package com.connect.messenger

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Foreground UI for a real incoming call, including while the screen is locked.
 *  The audio session is established by the authenticated WebRTC controller in MainActivity.
 */
class IncomingCallActivity : Activity() {
    private val closeHandler = Handler(Looper.getMainLooper())
    private var activeCallId: String? = null
    private val closeIfNotAnswered = Runnable { if (!isFinishing) finish() }
    private val checkCallEnded = object : Runnable {
        override fun run() {
            val id = activeCallId ?: return
            if (ConnectNotifications.preferences(this@IncomingCallActivity)
                    .getBoolean("call_closed_$id", false)) {
                if (!isFinishing) finish()
                return
            }
            if (!isFinishing && !isDestroyed) closeHandler.postDelayed(this, 350)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        volumeControlStream = AudioManager.STREAM_RING
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val id = intent.getStringExtra("connect_call_id")
        if (id == null || !id.matches(Regex("[0-9a-fA-F-]{36}"))) { finish(); return }
        activeCallId = id
        if (ConnectNotifications.preferences(this).getBoolean("call_closed_$id", false)) {
            finish()
            return
        }
        val name = intent.getStringExtra("connect_caller_name")?.take(80) ?: "Собеседник"
        val chatId = intent.getStringExtra("connect_chat_id")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(36, 64, 36, 64)
            setBackgroundColor(0xff111c2c.toInt())
        }
        fun title(value: String, size: Float) = TextView(this).apply {
            text = value
            textSize = size
            gravity = Gravity.CENTER
            setTextColor(android.graphics.Color.WHITE)
            setPadding(8, 20, 8, 20)
        }
        root.addView(title("CONNECT · АУДИОЗВОНОК", 15f))
        root.addView(title(name, 29f))
        root.addView(title("Входящий аудиозвонок", 17f))
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, 48, 0, 0)
        }
        fun action(label: String, background: Int, kind: String) = Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundTintList(android.content.res.ColorStateList.valueOf(background))
            setOnClickListener {
                ConnectNotifications.dismissCall(this@IncomingCallActivity, id)
                val open = Intent(this@IncomingCallActivity, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    putExtra("connect_call_action", kind)
                    putExtra("connect_call_id", id)
                    if (!chatId.isNullOrBlank()) putExtra("connect_chat_id", chatId)
                }
                startActivity(open)
                finish()
            }
        }
        actions.addView(action("Отклонить", 0xffb83c50.toInt(), "decline"),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        actions.addView(action("Принять", 0xff258c62.toInt(), "accept"),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(actions, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        closeHandler.post(checkCallEnded)
        closeHandler.postDelayed(closeIfNotAnswered, 65_000)
    }

    override fun onDestroy() {
        closeHandler.removeCallbacks(closeIfNotAnswered)
        closeHandler.removeCallbacks(checkCallEnded)
        activeCallId = null
        super.onDestroy()
    }
}
