package com.connect.messenger

import android.content.Intent
import android.app.AlertDialog
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

/** React is a view/client of the native coordinator, never the call engine. */
class ConnectCallCoordinatorModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context),LifecycleEventListener {
    private val handler=android.os.Handler(android.os.Looper.getMainLooper())
    private var presented=""
    private var listener:((JSONObject)->Unit)?=null
    private var alive=true
    @Volatile private var discovering=false
    private val discover=object:Runnable{override fun run(){
        if(!alive||context.lifecycleState!=com.facebook.react.common.LifecycleState.RESUMED)return
        // Native foreground fallback for delayed/missing FCM. It only discovers
        // an ID; the same service validates and owns the actual incoming call.
        if(!discovering&&ConnectCallSession.hasSession(context)&&ConnectCallService.snapshot().optString("phase")=="idle"){
            discovering=true
            ConnectCallSession.network.execute{try{
                val identity=ConnectCallSession.identity(context)
                val since=java.time.Instant.ofEpochMilli(ConnectCallServerClock.now(android.os.SystemClock.elapsedRealtime(),System.currentTimeMillis())-60000).toString()
                val rows=org.json.JSONArray(ConnectCallSession.api(context,"/supabase/rest/v1/connect_calls?callee_id=eq.${identity.first}&status=eq.ringing&created_at=gte.$since&select=id&order=created_at.desc&limit=1",expectedOwner=identity.first))
                val id=rows.optJSONObject(0)?.optString("id")
                handler.post{if(alive&&context.lifecycleState==com.facebook.react.common.LifecycleState.RESUMED&&identity.second==ConnectCallSession.epoch&&!id.isNullOrBlank())ConnectCallService.action(context,"incoming",id)}
            }catch(_:Exception){}finally{handler.post{discovering=false}}}
        }
        handler.postDelayed(this,3000)
    }}
    init{context.addLifecycleEventListener(this)}
    override fun onHostResume(){handler.removeCallbacks(discover);handler.post(discover)}
    override fun onHostPause(){handler.removeCallbacks(discover)}
    override fun onHostDestroy(){handler.removeCallbacks(discover)}
    private fun showOnce(state:JSONObject,attempt:Int=0){
        if(!context.hasActiveReactInstance())return
        if(state.optString("phase")=="idle"){presented="";return}
        val identity=state.optString("presentationId",state.optString("callId"))
        if(identity.isEmpty()||presented==identity)return
        if(ConnectIncomingCallActivity.visible){presented=identity;return}
        val activity=context.currentActivity
        if(activity?.hasWindowFocus()==true){
            try{activity.startActivity(Intent(context,ConnectIncomingCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP));presented=identity;ConnectCallDiagnostics.event(context,state.optString("callId"),"presentation","activity-requested","FOREGROUND")}
            catch(_:Exception){ConnectCallDiagnostics.event(context,state.optString("callId"),"presentation","failed","ACTIVITY_START_DENIED")}
        }
        else if(attempt<10)handler.postDelayed({val current=ConnectCallService.snapshot();if(current.optString("presentationId",current.optString("callId"))==identity)showOnce(current,attempt+1)},100)
    }
    override fun getName() = "ConnectCallCoordinator"
    private fun map(json: JSONObject): WritableMap = Arguments.createMap().apply {
        for (key in json.keys()) when (val value = json.opt(key)) {
            null, JSONObject.NULL -> putNull(key)
            is JSONObject -> putMap(key, map(value))
            is Boolean -> putBoolean(key, value)
            is Number -> putDouble(key, value.toDouble())
            else -> putString(key, value.toString())
        }
    }
    override fun initialize() {
        super.initialize()
        if(context.lifecycleState==com.facebook.react.common.LifecycleState.RESUMED)handler.post(discover)
        val old=context.getSharedPreferences("connect_incoming",0)
        val oldId=old.getString("id","")?:""
        if(oldId.isNotEmpty()&&!ConnectCallService.owns(oldId)&&old.getString("phase","") in listOf("active","reconnecting"))ConnectCallService.action(context,"recover",oldId)
        listener = { state ->
            if (context.hasActiveReactInstance()) {
                context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("connect:call-state", map(state))
                showOnce(state)
            }
        }
        ConnectCallService.observer=listener
    }
    override fun invalidate() { alive=false;context.removeLifecycleEventListener(this);if(ConnectCallService.observer===listener)ConnectCallService.observer=null;handler.removeCallbacksAndMessages(null);super.invalidate() }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
    @ReactMethod fun traceBridge(command:String,requestId:String,stage:String,promise:Promise){
        if(command.startsWith("calls:")&&requestId.matches(Regex("[A-Za-z0-9:_-]{1,80}"))&&stage in listOf("START","DONE","ERROR","TIMEOUT"))ConnectCallDiagnostics.event(context,ConnectCallService.snapshot().optString("callId"),"bridge",stage,"",mapOf("command" to command,"requestId" to requestId))
        promise.resolve(true)
    }
    @ReactMethod fun getState(promise: Promise) { promise.resolve(map(ConnectCallService.snapshot())) }
    @ReactMethod fun dial(conversation: String, peer: String, name: String, operation: String, promise: Promise) {
        if (!conversation.matches(Regex("[0-9a-fA-F-]{36}")) || !peer.matches(Regex("[0-9a-fA-F-]{36}")) || !operation.matches(Regex("[0-9a-fA-F-]{36}"))) { promise.reject("CALL_INPUT", "Некорректный собеседник"); return }
        context.runOnUiQueueThread {
          fun dispatch(attempt:Int){
            if(context.lifecycleState!=com.facebook.react.common.LifecycleState.RESUMED||context.currentActivity?.hasWindowFocus()!=true){
                if(attempt<20){handler.postDelayed({dispatch(attempt+1)},100);return}
                promise.reject("CALL_WINDOW","Откройте Connect для исходящего звонка");return
            }
            if(context.getSharedPreferences("connect_incoming",0).contains("ended:$operation")){promise.reject("CALL_CANCELLED","Вызов отменён");return}
            if(ConnectCallService.snapshot().optString("phase")!="idle"){promise.reject("CALL_BUSY","Другой вызов уже выполняется");return}
            val registered=ConnectCallOperations.await(operation,{ConnectCallService.action(context,"preparation-timeout",operation)}){id,error->
                if(error!=null)promise.reject("CALL_PREPARATION",error)else promise.resolve(id)
            }
            if(!registered){promise.reject("CALL_BUSY","Вызов уже подготавливается");return}
            if(!ConnectCallService.action(context,"dial",operation,conversation=conversation,name=name,peer=peer))ConnectCallOperations.complete(operation,null,"Android запретил запуск службы звонка")
          }
          dispatch(0)
        }
    }
    @ReactMethod fun incoming(id: String, promise: Promise) { ConnectCallService.action(context, "incoming", id); promise.resolve(true) }
    @ReactMethod fun control(id: String, action: String, promise: Promise) {
        if (!id.matches(Regex("[0-9a-fA-F-]{36}"))) { promise.reject("CALL_INPUT", "Некорректный вызов"); return }
        if (action !in listOf("answer", "decline", "end", "mute", "speaker", "sync", "bridge-timeout")) { promise.reject("CALL_INPUT", "Неизвестное действие"); return }
        if (action in listOf("end","bridge-timeout")) context.getSharedPreferences("connect_incoming",0).edit().putLong("ended:$id",System.currentTimeMillis()).apply()
        if (action == "answer") context.runOnUiQueueThread {
            if (!ConnectCallService.owns(id)) { promise.resolve(false); return@runOnUiQueueThread }
            try { context.startActivity(Intent(context, ConnectIncomingCallActivity::class.java).putExtra("acceptCall", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)); promise.resolve(true) }
            catch (error: Exception) { promise.reject("CALL_WINDOW", "Откройте экран вызова", error) }
        } else { ConnectCallService.action(context, action, id); promise.resolve(true) }
    }
    @ReactMethod fun chooseRoute(promise: Promise) {
        context.runOnUiQueueThread {
            val activity = context.currentActivity
            if (activity == null) { promise.reject("CALL_WINDOW", "Откройте экран вызова"); return@runOnUiQueueThread }
            showRoutes(activity); promise.resolve(true)
        }
    }
    @ReactMethod fun getCallVibration(promise:Promise) {
        promise.resolve(context.getSharedPreferences("connect_call_settings",0).getBoolean("callVibrationV2",true))
    }
    @ReactMethod fun configureSounds(uri: String, silent: Boolean, vibrate: Boolean, previousChannel: String, promise: Promise) {
        if (uri.isNotEmpty() && !uri.startsWith("content://media/")) { promise.reject("CALL_SOUND", "Недопустимая мелодия"); return }
        context.getSharedPreferences("connect_call_settings", 0).edit().putString("uri", uri.takeIf { it.isNotEmpty() }).putBoolean("silent", silent).putBoolean("vibrate", vibrate).putBoolean("callVibrationV2",vibrate).putString("legacyChannel", previousChannel.take(200)).apply()
        promise.resolve(ConnectCallService.CHANNEL)
    }
    @ReactMethod fun getAuth(name: String, promise: Promise) { ConnectCallSession.worker.execute { try { promise.resolve(ConnectCallSession.read(context, name)) } catch (error: Exception) { promise.reject("CALL_AUTH_STORAGE", "Сессия недоступна", error) } } }
    @ReactMethod fun setAuth(name: String, value: String, promise: Promise) { ConnectCallSession.worker.execute { try {
        if(name.endsWith("-auth-token")){val next=JSONObject(value).optJSONObject("user")?.optString("id");val previous=try{JSONObject(ConnectCallSession.read(context,name)?:"{}").optJSONObject("user")?.optString("id")}catch(_:Exception){ConnectCallService.snapshot().optString("userId")};if(!previous.isNullOrEmpty()&&next!=previous)ConnectCallService.action(context,"logout")}
        ConnectCallSession.write(context, name, value);if(name.endsWith("-auth-token"))ConnectPushTokenJob.enable(context);promise.resolve(null)
    } catch (error: Exception) { promise.reject("CALL_AUTH_STORAGE", "Сессию не удалось сохранить", error) } } }
    @ReactMethod fun removeAuth(name: String, promise: Promise) { ConnectCallSession.worker.execute { try { if(name.endsWith("-auth-token")){ConnectCallService.action(context,"logout");ConnectPushTokenJob.cancel(context);ConnectCallIngress.clear(context)}; ConnectCallSession.write(context, name, null); promise.resolve(null) } catch (error: Exception) { promise.reject("CALL_AUTH_STORAGE", "Сессию не удалось удалить", error) } } }
    companion object {
        fun showRoutes(activity: android.app.Activity) {
            val state = ConnectCallService.snapshot(); val id = state.optString("callId"); val supported = state.optInt("supportedRoutes")
            val routes = listOf(1 to "Телефон", 2 to "Bluetooth", 4 to "Проводная гарнитура", 8 to "Динамик").filter { it.first and supported != 0 }
            AlertDialog.Builder(activity).setTitle("Вывод звука").setSingleChoiceItems(routes.map { it.second }.toTypedArray(), routes.indexOfFirst { it.first == state.optInt("route") }) { dialog, index ->
                ConnectCallService.action(activity, "route", id, route = routes[index].first); dialog.dismiss()
            }.setNegativeButton("Отмена", null).show()
        }
    }
}
