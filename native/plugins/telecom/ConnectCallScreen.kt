package com.connect.messenger

import android.app.Activity
import android.app.PendingIntent
import android.app.ActivityOptions
import android.app.Application
import android.app.KeyguardManager
import android.content.*
import android.os.*
import android.net.Uri
import java.lang.ref.WeakReference

/** Installed in Application, before React. Never starts a background Activity on unlock. */
internal object ConnectCallScreen : Application.ActivityLifecycleCallbacks {
    private val handler = Handler(Looper.getMainLooper())
    private val gate = ConnectCallScreenGate()
    private var installed = false
    private var resumed: WeakReference<Activity>? = null
    fun intent(context: Context, id: String) = Intent(context, ConnectIncomingCallActivity::class.java)
        .setData(Uri.parse("connect://native-call/$id")).putExtra("callId", id)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    fun pending(context:Context,id:String,answer:Boolean=false):PendingIntent {
        val target=intent(context,id).setAction(context.packageName+if(answer)".CALL_ANSWER" else ".CALL_OPEN")
        if(answer)target.putExtra("acceptCall",id)
        val options=if(Build.VERSION.SDK_INT>=35)ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(
            if(Build.VERSION.SDK_INT>=36)ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS else ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle() else null
        return PendingIntent.getActivity(context,if(answer)53 else 51,target,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,options)
    }
    fun install(app: Application) {
        if (installed) return
        installed = true; app.registerActivityLifecycleCallbacks(this)
        androidx.core.content.ContextCompat.registerReceiver(app, object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val state = ConnectCallService.snapshot(); val id = state.optString("callId")
                if (!ConnectCallService.owns(id)) return
                ConnectCallDiagnostics.event(context,id,"presentation","DEVICE_UNLOCKED")
                // USER_PRESENT is not permission to launch from the background.
                ConnectCallService.restorePresentation(id)
                restore(context,"DEVICE_UNLOCKED")
            }
        }, IntentFilter(Intent.ACTION_USER_PRESENT), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
    }
    fun restore(context: Context, source: String) {
        val state = ConnectCallService.snapshot(); val id = state.optString("callId")
        val activity = resumed?.get()
        val live = ConnectCallService.owns(id) && state.optString("phase") != "idle"
        if (!live) { gate.clear(); return }
        if(!ConnectCallService.presentationReady(id))return
        if(activity is ConnectIncomingCallActivity&&!activity.isFinishing&&!activity.isDestroyed)return
        val allowed = activity != null && !activity.isFinishing && !activity.isDestroyed && activity !is ConnectCallSetupActivity
        val decision = gate.request(id,live,ConnectIncomingCallActivity.visible,allowed,SystemClock.elapsedRealtime())
        if (decision != "REQUEST") {
            if (decision == "NOT_FOREGROUND") ConnectCallDiagnostics.event(context,id,"foreground-presentation","DEFERRED",decision)
            return
        }
        ConnectCallDiagnostics.event(context,id,"presentation","RESTORE_PRESENTATION",source)
        try { activity!!.startActivity(intent(context,id)) }
        catch(error:Exception) { ConnectCallDiagnostics.exception(context,id,"presentation","ACTIVITY_START_DENIED",error) }
    }
    fun requested(context: Context, id: String) {
        if(context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)ConnectCallDiagnostics.event(context,id,"presentation","KEYGUARD_LOCKED")
        ConnectCallDiagnostics.event(context,id,"presentation","PRESENTATION_REQUESTED",details=mapOf("keyguardLocked" to context.getSystemService(KeyguardManager::class.java).isKeyguardLocked))
        restore(context,"NATIVE_STATE")
        handler.postDelayed({ if(ConnectCallService.owns(id)&&!ConnectIncomingCallActivity.visible)
            ConnectCallDiagnostics.event(context,id,"presentation","VISIBILITY_UNCONFIRMED","SCREEN_NOT_CONFIRMED") },1800)
    }
    override fun onActivityResumed(activity: Activity) { ConnectMissedCalls.foreground=activity is MainActivity;resumed=WeakReference(activity); handler.post { restore(activity,"HOST_RESUMED") } }
    override fun onActivityPaused(activity: Activity) { if(resumed?.get()===activity){resumed=null;ConnectMissedCalls.foreground=false} }
    override fun onActivityCreated(activity: Activity, saved: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, saved: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) { if(resumed?.get()===activity)resumed=null }
}
