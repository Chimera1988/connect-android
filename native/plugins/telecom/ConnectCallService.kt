package com.connect.messenger

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.os.*
import android.telecom.*
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentLinkedQueue

/** One actor owns one call. FCM is a hint; every incoming/end hint is checked
 * against the authenticated row. No React, WebView, Notifee or CallKeep engine. */
class ConnectCallService : Service() {
    companion object {
        private val incomingGate=ConnectIncomingGate()
        const val CHANNEL = "connect-native-calls-service-v6"
        private const val NOTIFICATION = 0x434f4e
        @Volatile private var instance: ConnectCallService? = null
        @Volatile var observer: ((JSONObject) -> Unit)? = null
        @Volatile private var last = JSONObject().put("phase", "idle").put("state", "IDLE")
        @Volatile private var sequence = 0L
        fun owns(id: String) = instance?.machine?.let { it.id.equals(id,ignoreCase=true) && !it.terminal() } == true
        fun snapshot(): JSONObject = instance?.let { if (it.machine.terminal()) JSONObject(last.toString()) else it.view() } ?: JSONObject(last.toString())
        fun action(context: Context, action: String, id: String = "", conversation: String = "", name: String = "", peer: String = "", route: Int = 0): Boolean {
            if (action in listOf("sync", "end", "decline", "answer", "mute", "speaker", "route", "logout", "failed", "remote-end", "bridge-timeout", "preparation-timeout") && instance == null) return false
            if(action=="incoming"){
                if(owns(id)){ConnectCallIngress.acknowledge(context,id);return true}
                val decision=incomingGate.dispatch(id,android.os.SystemClock.elapsedRealtime())
                if(decision!="DISPATCH"){
                    ConnectCallDiagnostics.event(context,id,"dispatch","ignored",decision)
                    if(decision=="TERMINAL"||decision=="OWNED")ConnectCallIngress.acknowledge(context,id)
                    return true
                }
                ConnectCallDiagnostics.event(context,id,"transition","RECEIVED","INCOMING_HINT",mapOf("from" to "NONE","to" to "RECEIVED","source" to "DISPATCH"))
            }
            val intent = Intent(context, ConnectCallService::class.java).putExtra("action", action).putExtra("id", id.lowercase())
                .putExtra("conversation", conversation).putExtra("name", name.take(160)).putExtra("peer", peer).putExtra("route", route)
            return try { context.startForegroundService(intent); true }
            catch (_: Exception) { if(action=="incoming")incomingGate.retry(id,SystemClock.elapsedRealtime());ConnectCallDiagnostics.event(context,id,"service","denied","FOREGROUND_START"); false }
        }
        fun restorePresentation(id:String) { instance?.handler?.post { instance?.let { s ->
            if(owns(id)&&s.incoming&&s.machine.phase==ConnectCallState.Phase.INCOMING){s.showNotification();ConnectCallScreen.restore(s,"DEVICE_UNLOCKED")}
        } } }
        fun telecomFocus(id:String,available:Boolean,released:(()->Unit)?=null) { val s=instance
            if(s==null){released?.invoke();return}
            s.handler.post { try{if(s.machine.id==id&&!s.machine.terminal())try{s.applyFocus(available)}catch(error:Exception){s.failedOperation(error,"adm-create","TELECOM_AUDIO")}}finally{released?.invoke()} }
        }
        fun audioState(id: String, state: CallAudioState) { instance?.handler?.post { instance?.applyAudioState(id, state) } }
        fun telecomFailed(id: String) { instance?.handler?.post { val s = instance; if (s != null && s.machine.id == id) s.end(ConnectCallState.Phase.FAILED, "Аудиоустройство занято",source="TELECOM") } }
        fun pending(context: Context, action: String, id: String): PendingIntent =
            if (action == "answer") PendingIntent.getActivity(context, (action + id).hashCode(), ConnectCallScreen.intent(context,id).putExtra("acceptCall", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            else PendingIntent.getService(context, (action + id).hashCode(), Intent(context, ConnectCallService::class.java).putExtra("action", action).putExtra("id", id.lowercase()), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val machine = ConnectCallState()
    private lateinit var sounds: ConnectCallAudio
    private var row: JSONObject? = null
    private var owner = ""; private var name = "Собеседник"; private var peerId = ""; private var avatar = ""
    private var incoming = false; private var accepting = false; private var muted = false; private var telecomMuted = false
    private var route = CallAudioState.ROUTE_EARPIECE; private var supportedRoutes = CallAudioState.ROUTE_EARPIECE or CallAudioState.ROUTE_SPEAKER
    private var peer: PeerConnection? = null; private var factory: PeerConnectionFactory? = null
    private var device: JavaAudioDeviceModule? = null; private var source: AudioSource? = null; private var local: AudioTrack? = null
    private var remoteAudio = false; private var recording = false; private var playout = false
    private var lastReadiness=""
    private val audioGate = ConnectCallAudioGate()
    private val focusAvailable get() = audioGate.focus
    private var polling = false; private var remoteSet = false; private var answerApplying = false
    private var setupAt = 0L; private var activeAt = 0L; private var lostAt = 0L; private var ringDeadline = 0L
    private val localIce = ConcurrentLinkedQueue<IceCandidate>()
    private val remoteIce = mutableListOf<IceCandidate>()
    private val knownIce = mutableSetOf<Long>()
    private var wake: PowerManager.WakeLock? = null
    private val verifying = mutableSetOf<String>()
    @Volatile private var callEpoch=ConnectCallSession.epoch
    private var destroyed = false
    private var operationId = ""
    private var incomingPosted = false
    private val mediaEvidence = ConnectCallMediaEvidence()
    private var statsPending = false
    private var networkEvidenceLogged=false
    private var lastRemoteIceId = 0L
    private class RemoteCallDone(val status: String) : Exception()
    private var tick:Runnable?=null
    private fun transition(before:ConnectCallState.Phase,source:String){
        fun label(phase:ConnectCallState.Phase)=when(phase){ConnectCallState.Phase.INCOMING,ConnectCallState.Phase.REMOTE_RINGING->"RINGING";else->phase.name}
        val from=if(machine.phase==ConnectCallState.Phase.PRESENTING)"VALIDATING" else label(before)
        if(before!=machine.phase)ConnectCallDiagnostics.event(this,machine.id,"transition",label(machine.phase),"",mapOf("from" to from,"to" to label(machine.phase),"source" to source,"generation" to machine.revision,"operationId" to operationId))
    }
    private fun startTick(){
        tick?.let{handler.removeCallbacks(it)}
        val generation=machine.revision
        val task=object:Runnable{
          override fun run(){
            if(destroyed||generation!=machine.revision||machine.terminal()||machine.phase==ConnectCallState.Phase.IDLE){ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"timer","ignored","STALE_GENERATION");return}
            if(callEpoch!=ConnectCallSession.epoch){verifying.clear();end(ConnectCallState.Phase.ENDED,notifyServer=false,source="AUTH_CHANGED");return}
            val now=SystemClock.elapsedRealtime()
            if(machine.phase in listOf(ConnectCallState.Phase.INCOMING,ConnectCallState.Phase.REMOTE_RINGING)&&ConnectCallTiming.expired(generation,machine.revision,ringDeadline,now)){
                ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"timer","expired","RING_DEADLINE",mapOf("deadlineElapsedMs" to ringDeadline,"remainingMs" to (ringDeadline-now),"generation" to generation))
                end(if(incoming)ConnectCallState.Phase.MISSED else ConnectCallState.Phase.NO_ANSWER,"Нет ответа",!incoming,"TIMER_RING");return
            }
            if(activeAt==0L&&machine.phase in listOf(ConnectCallState.Phase.PREPARING,ConnectCallState.Phase.OFFER_CREATED,ConnectCallState.Phase.ANSWERING,ConnectCallState.Phase.CONNECTING)&&now-setupAt>=25000){end(ConnectCallState.Phase.FAILED,"Не удалось установить аудиосоединение",source="TIMER_SETUP");return}
            if(lostAt>0&&now-lostAt>=20000){end(ConnectCallState.Phase.FAILED,"Соединение потеряно",source="TIMER_RECONNECT");return}
            if(wake?.isHeld!=true)wake?.acquire(10*60*1000L)
            sounds.route(route,machine.phase==ConnectCallState.Phase.ACTIVE);sync();sampleMedia()
            handler.postDelayed(this,1400)
          }
        }
        tick=task;handler.post(task)
    }
    private fun ringWindow(item:JSONObject):ConnectCallTiming.Window{
        val elapsed=SystemClock.elapsedRealtime();val created=ConnectCallTiming.parse(item.optString("created_at"))
        val serverNow=ConnectCallServerClock.now(elapsed,System.currentTimeMillis())
        val result=ConnectCallTiming.window(created,serverNow,elapsed)
        ConnectCallDiagnostics.event(this,item.optString("id"),"deadline",result.reason,"",mapOf("createdEpochMs" to (created?:-1),"serverNowMs" to serverNow,"serverAgeMs" to result.age,"deadlineElapsedMs" to result.deadline,"remainingMs" to result.remaining,"clock" to ConnectCallServerClock.source()))
        return result
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate(); instance = this
        try{ConnectCallConnectionService.account(this);ConnectCallDiagnostics.event(this,"","telecom","registered")}catch(_:Exception){ConnectCallDiagnostics.event(this,"","telecom","failed","REGISTER")}
        ConnectCallSession.network.execute { retryPendingFinishes() }
        ConnectCallScreen.install(application)
        sounds = ConnectCallAudio(this)
        val manager = getSystemService(NotificationManager::class.java)
        manager.activeNotifications.filter { it.notification.category == Notification.CATEGORY_CALL && it.notification.channelId.startsWith("connect-native-calls-") && it.notification.channelId != CHANNEL }.forEach { manager.cancel(it.tag,it.id) }
        if (manager.getNotificationChannel(CHANNEL) == null) {
            val settings = getSharedPreferences("connect_call_settings", 0)
            val legacy = settings.getString("legacyChannel", null)?.let { manager.getNotificationChannel(it) }
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Connect · Аудиозвонки", legacy?.importance ?: NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Входящие и активные аудиозвонки Connect"; setSound(null, null); enableVibration(false); lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            })
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.getStringExtra("action") ?: return START_NOT_STICKY
        val id = intent.getStringExtra("id") ?: ""
        ConnectCallDiagnostics.event(this,id,"service",action)
        if(action=="logout"){verifying.clear();end(ConnectCallState.Phase.ENDED);return START_NOT_STICKY}
        if(!ConnectCallState.allowStart(action,machine.phase!=ConnectCallState.Phase.IDLE&&!machine.terminal(),getSharedPreferences("connect_incoming",0).contains("ended:$id"))){stopIfIdle();return START_NOT_STICKY}
        // Meet the foreground deadline before network work. This is a silent
        // service notification, never an unverified incoming screen/ringtone.
        if (machine.phase == ConnectCallState.Phase.IDLE || machine.terminal()) startForeground(NOTIFICATION, notification(false), ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
        when (action) {
            "recover" -> recover(id)
            "incoming" -> if (id.matches(Regex("[0-9a-fA-F-]{36}"))) receive(id)
            "dial" -> if (machine.phase == ConnectCallState.Phase.IDLE || machine.terminal()) {
                if (getSharedPreferences("connect_incoming",0).contains("ended:$id")) stopIfIdle()
                else dial(intent.getStringExtra("conversation") ?: "", intent.getStringExtra("peer") ?: "", intent.getStringExtra("name") ?: "Собеседник", id)
            }
            "sync" -> if (machine.id == id) sync()
            "remote-end" -> if (machine.id == id) { ConnectCallDiagnostics.event(this,id,"reconcile","requested","FCM_END");sync() }
            "answer" -> if (machine.id == id) accept()
            "decline" -> if (machine.id == id) end(ConnectCallState.Phase.DECLINED,source="USER")
            "end" -> if (machine.id == id || operationId == id) end(if(!incoming&&row?.optString("status")!="active")ConnectCallState.Phase.CANCELLED else ConnectCallState.Phase.ENDED,source="USER")
            "bridge-timeout","preparation-timeout" -> if(machine.id==id||operationId==id)end(ConnectCallState.Phase.FAILED,"Подготовка звонка не завершена вовремя",source=if(action=="bridge-timeout")"BRIDGE_TIMEOUT" else "TIMER_ACK")
            "failed" -> if (machine.id == id) end(ConnectCallState.Phase.FAILED, "Для аудиозвонка нужен доступ к микрофону")
            "mute" -> if (machine.id == id) { muted = !muted; local?.setEnabled(focusAvailable&&!muted); publish() }
            "speaker" -> if (machine.id == id) selectRoute(if (route == CallAudioState.ROUTE_SPEAKER) preferredRoute() else CallAudioState.ROUTE_SPEAKER)
            "route" -> if (machine.id == id) selectRoute(intent.getIntExtra("route", 0))
            "logout" -> end(ConnectCallState.Phase.ENDED)
        }
        return START_NOT_STICKY
    }
    private fun recover(id:String){
        if(!id.matches(Regex("[0-9a-fA-F-]{36}"))||owns(id)){stopIfIdle();return}
        worker.execute { try {
            val user=ConnectCallSession.owner(this)
            val item=JSONArray(ConnectCallSession.api(this,"/supabase/rest/v1/connect_calls?id=eq.$id&select=caller_id,callee_id,status&limit=1")).optJSONObject(0)
            if(item!=null&&item.optString("status")=="active"&&user in listOf(item.optString("caller_id"),item.optString("callee_id")))finishServer(id,"failed",user)
        }catch(_:Exception){}finally{handler.post{
            val p=getSharedPreferences("connect_incoming",0);if(p.getString("id","")==id)p.edit().remove("id").putLong("ended:$id",System.currentTimeMillis()).apply();stopIfIdle()
        }} }
    }
    private fun valid(token:Int)=!destroyed&&machine.valid(token)&&callEpoch==ConnectCallSession.epoch
    private fun resetCallPresentation(){
        muted=false;telecomMuted=false;route=CallAudioState.ROUTE_EARPIECE;supportedRoutes=CallAudioState.ROUTE_EARPIECE or CallAudioState.ROUTE_SPEAKER
        ringDeadline=0;remoteAudio=false;recording=false;playout=false;incomingPosted=false;lastReadiness="";audioGate.reset();mediaEvidence.reset();statsPending=false;networkEvidenceLogged=false
    }
    private fun receive(id: String) {
        if (owns(id)) {ConnectCallIngress.acknowledge(this,id);return}
        if(id in verifying)return
        if(getSharedPreferences("connect_incoming",0).contains("ended:$id")){ConnectCallIngress.acknowledge(this,id);stopIfIdle();return}
        verifying.add(id);incomingGate.validating(id)
        ConnectCallDiagnostics.event(this,id,"transition","VALIDATING","",mapOf("from" to "RECEIVED","to" to "VALIDATING","source" to "SERVICE"))
        worker.execute {
            try {
                val identity=ConnectCallSession.identity(this);val user=identity.first;val epoch=identity.second
                val rows = JSONArray(ConnectCallSession.api(this, "/supabase/rest/v1/connect_calls?id=eq.$id&select=*&limit=1"))
                val next = rows.optJSONObject(0)
                handler.post {
                    if (destroyed) return@post
                    verifying.remove(id)
                    if (owns(id)) {ConnectCallIngress.acknowledge(this,id);return@post}
                    val window=next?.let{ringWindow(it)}
                    val reason=ConnectCallValidation.reason(user,next?.optString("callee_id")?:"",next?.optString("status")?:"",window,epoch==ConnectCallSession.epoch,getSharedPreferences("connect_incoming",0).contains("ended:$id"))
                    ConnectCallDiagnostics.event(this,id,"validation",if(reason=="VALID")"CALL_VALIDATED" else "rejected",reason)
                    if(reason!="VALID"){incomingGate.terminal(id,SystemClock.elapsedRealtime());ConnectCallIngress.acknowledge(this,id);stopIfIdle();return@post}
                    if(machine.phase!=ConnectCallState.Phase.IDLE&&!machine.terminal()){incomingGate.terminal(id,SystemClock.elapsedRealtime());ConnectCallIngress.acknowledge(this,id);finishServer(id,"busy",user);return@post}
                    resetCallPresentation()
                    owner = user; incoming = true; operationId="";row = next; peerId = next!!.getString("caller_id"); name = "Собеседник"; avatar = ""
                    incomingPosted=false;callEpoch=epoch;val before=machine.phase;machine.begin(id,true);machine.presenting();transition(before,"VALIDATED_INCOMING")
                    setupAt=SystemClock.elapsedRealtime();activeAt=0;lostAt=0;ringDeadline=window!!.deadline
                    incomingGate.owned(id)
                    holdWake();telecom(true);publish();showNotification()
                    try{sounds.incoming()}catch(_:Exception){ConnectCallDiagnostics.event(this,id,"signals","failed","SIGNAL_EXCEPTION")}
                    val presenting=machine.phase;machine.ringing();transition(presenting,"PRESENTATION_REQUESTED")
                    publish();ConnectCallScreen.requested(this,id);ConnectCallIngress.acknowledge(this,id);resolveProfile(peerId);startTick()
                }
            }catch(error:Exception){handler.post{
                if(!destroyed){
                    verifying.remove(id);incomingGate.retry(id,SystemClock.elapsedRealtime())
                    val code=ConnectCallValidation.failure((error as? ConnectCallSession.HttpFailure)?.status,ConnectCallSession.hasSession(this),error is java.io.IOException)
                    ConnectCallDiagnostics.event(this,id,"validation","retry",code)
                    ConnectCallIngress.retry(this,id);stopIfIdle()
                }
            }}
        }
    }
    private fun dial(conversation: String, remote: String, displayName: String, clientOperation: String) {
        if (!conversation.matches(Regex("[0-9a-fA-F-]{36}")) || !remote.matches(Regex("[0-9a-fA-F-]{36}"))) { stopIfIdle(); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { ConnectCallOperations.complete(clientOperation,null,"Для аудиозвонка разрешите доступ к микрофону");stopIfIdle(); return }
        resetCallPresentation()
        incoming = false; row = null; owner = ""; peerId = remote; name = displayName.take(160); avatar = ""; activeAt = 0; lostAt = 0; muted = false
        operationId = clientOperation.takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) } ?: UUID.randomUUID().toString()
        callEpoch=ConnectCallSession.epoch
        val before=machine.phase;val token = machine.begin(operationId, false);transition(before,"USER_DIAL")
        setupAt = SystemClock.elapsedRealtime()
        try{microphoneForeground()}catch(_:Exception){end(ConnectCallState.Phase.FAILED,"Android не разрешил фоновую аудиосессию");return}
        holdWake(); publish(); showNotification()
        startTick()
        network(token, {
            ConnectCallDiagnostics.event(this,operationId,"microphone","checking")
            ConnectMicrophoneProbe.check(this)
            ConnectCallDiagnostics.event(this,operationId,"microphone","ready")
            val user = ConnectCallSession.owner(this)
            val ice = iceServers()
            Pair(user, ice)
        }) { result ->
            owner = result.first; createPeer(token, result.second)
            val connection = peer ?: return@network
            connection.createOffer(sdp(token) { offer ->
                connection.setLocalDescription(sdp(token) {
                  gathered(token,connection,offer) { submittedOffer ->
                    val offered=machine.phase;machine.offered();transition(offered,"LOCAL_SDP_READY")
                    val callOwner = owner
                    network(token, { JSONObject(ConnectCallSession.api(this, "/supabase/rest/v1/rpc/connect_start_audio_call", JSONObject().put("p_conversation_id", conversation).put("p_offer", JSONObject().put("type", "offer").put("sdp", submittedOffer.description)),expectedOwner=callOwner)) }, orphan = { finishServer(it.optString("id"), "hangup", callOwner) }) { started ->
                        check(started.optString("caller_id")==owner&&started.optString("conversation_id")==conversation)
                        row=started;peerId=started.getString("callee_id")
                        val window=ringWindow(started)
                        if(!window.valid){end(ConnectCallState.Phase.FAILED,"Сервер передал некорректное время вызова",source="SERVER_TIMESTAMP");return@network}
                        ringDeadline=window.deadline;val before=machine.phase;machine.identified(started.getString("id"));transition(before,"SERVER_CREATED")
                        ConnectCallDiagnostics.event(this,machine.id,"created","ringing",operationId)
                        ConnectCallOperations.complete(operationId,machine.id,null)
                        telecom(false); sounds.signal(false); publish(); showNotification(); resolveProfile(peerId)
                        notifyIncoming(started.getString("id"),owner)
                        sync()
                    }
                  }
                }, offer)
            }, MediaConstraints())
        }
    }
    private fun accept() {
        if (machine.phase != ConnectCallState.Phase.INCOMING || accepting) return
        sounds.stopSignals()
        if (!ConnectIncomingCallActivity.visible) {
            try { startActivity(Intent(this, ConnectIncomingCallActivity::class.java).putExtra("acceptCall", machine.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
            catch (_: Exception) { end(ConnectCallState.Phase.FAILED, "Откройте экран вызова") }
            return
        }
        // Permission belongs to a visible native Activity, never a background receiver.
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            startActivity(Intent(this, ConnectIncomingCallActivity::class.java).putExtra("acceptPermission", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)); return
        }
        accepting=true;val before=machine.phase;machine.answering();transition(before,"USER_ANSWER");setupAt = SystemClock.elapsedRealtime()
        try{microphoneForeground()}catch(_:Exception){end(ConnectCallState.Phase.FAILED,"Android не разрешил фоновую аудиосессию");return}
        publish(); showNotification()
        val token = machine.revision; val id = machine.id
        network(token, {
            ConnectMicrophoneProbe.check(this)
            ConnectCallDiagnostics.event(this,id,"microphone","ready")
            val fresh = JSONArray(ConnectCallSession.api(this, "/supabase/rest/v1/connect_calls?id=eq.$id&select=*&limit=1")).optJSONObject(0) ?: error("Вызов завершён")
            check(fresh.optString("callee_id") == owner) { "Вызов принадлежит другому аккаунту" }
            if (fresh.optString("status") != "ringing") throw RemoteCallDone(fresh.optString("status"))
            Pair(fresh, iceServers())
        }) { result ->
            val offer = ConnectCallErrors.at("sdp","INVALID_OFFER"){result.first.getJSONObject("offer").also{checkAudioSdp(it.getString("sdp"))}}
            row = result.first; ConnectCallConnectionService.answered(machine.id); createPeer(token, result.second)
            val connection = peer ?: return@network
            connection.setRemoteDescription(sdp(token) {
                remoteSet = true; flushRemote()
                connection.createAnswer(sdp(token) { answer ->
                    connection.setLocalDescription(sdp(token) {
                      gathered(token,connection,answer) { submittedAnswer ->
                        machine.submitAnswer(submittedAnswer.description)
                        val acceptingOwner = owner
                        network(token, {
                            try { JSONObject(ConnectCallSession.api(this, "/supabase/rest/v1/rpc/connect_answer_audio_call", JSONObject().put("p_call_id", id).put("p_answer", JSONObject().put("type", "answer").put("sdp", submittedAnswer.description)))) }
                            catch (error: Exception) {
                                val fresh = JSONArray(ConnectCallSession.api(this,"/supabase/rest/v1/connect_calls?id=eq.$id&select=*&limit=1")).optJSONObject(0) ?: throw RemoteCallDone("ended")
                                if (fresh.optString("status") == "active" && fresh.optJSONObject("answer")?.optString("sdp") == submittedAnswer.description) fresh
                                else if (fresh.optString("status") != "ringing") throw RemoteCallDone(fresh.optString("status"))
                                else throw error
                            }
                        }, orphan = { accepted ->
                            if(accepted.optJSONObject("answer")?.optString("sdp")==submittedAnswer.description)finishServer(id,"hangup",acceptingOwner)
                        }) { accepted -> row=accepted;accepting=false;val before=machine.phase;machine.answered();ConnectCallConnectionService.answered(machine.id);transition(before,"SERVER_ANSWERED");publish();sync() }
                      }
                    }, answer)
                }, MediaConstraints())
            }, SessionDescription(SessionDescription.Type.OFFER, offer.getString("sdp")))
        }
    }
    private fun gathered(token:Int,connection:PeerConnection,fallback:SessionDescription,done:(SessionDescription)->Unit){
        val deadline=SystemClock.elapsedRealtime()+1800
        val poll=object:Runnable{override fun run(){
            if(!valid(token))return
            if(connection.iceGatheringState()!=PeerConnection.IceGatheringState.COMPLETE&&SystemClock.elapsedRealtime()<deadline){handler.postDelayed(this,60);return}
            val submitted=connection.localDescription?.takeIf{it.type==fallback.type&&it.description.isNotBlank()}?:fallback
            ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,if(fallback.type==SessionDescription.Type.OFFER)"offer" else "answer","ready","INLINE_ICE_${submitted.description.lineSequence().count{it.startsWith("a=candidate:")}}")
            try{done(submitted)}catch(error:Exception){failedOperation(error,"sdp","SUBMIT_DESCRIPTION")}
        }}
        handler.post(poll)
    }
    private fun microphoneForeground(){
        // Only a visible outgoing action/answer reaches microphone foreground type.
        val foregroundType=ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or if(Build.VERSION.SDK_INT>=30)ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
        startForeground(NOTIFICATION, notification(false), foregroundType)
    }
    private fun createPeer(token: Int, servers: List<PeerConnection.IceServer>) {
        ConnectCallErrors.at("webrtc-peer","PEER_ALREADY_EXISTS"){check(peer == null)}
        sounds.communication()
        ConnectCallErrors.at("webrtc-init","INITIALIZATION"){PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions())}
        recording = false; playout = false; remoteAudio = false
        fun audioError(stage:String,code:String){handler.post{if(valid(token)){
            ConnectCallDiagnostics.event(this,machine.id,stage,"FAILED",code)
            end(ConnectCallState.Phase.FAILED,ConnectCallErrors.message(stage),source=code)
        }}}
        device = ConnectCallErrors.at("adm-create","ADM_CREATE"){JavaAudioDeviceModule.builder(this)
            .setAudioRecordErrorCallback(object:JavaAudioDeviceModule.AudioRecordErrorCallback{
                override fun onWebRtcAudioRecordInitError(error:String){audioError("adm-record","INIT")}
                override fun onWebRtcAudioRecordStartError(code:JavaAudioDeviceModule.AudioRecordStartErrorCode,error:String){audioError("adm-record","START")}
                override fun onWebRtcAudioRecordError(error:String){audioError("adm-record","RUNTIME")}
            })
            .setAudioTrackErrorCallback(object:JavaAudioDeviceModule.AudioTrackErrorCallback{
                override fun onWebRtcAudioTrackInitError(error:String){audioError("adm-playout","INIT")}
                override fun onWebRtcAudioTrackStartError(code:JavaAudioDeviceModule.AudioTrackStartErrorCode,error:String){audioError("adm-playout","START")}
                override fun onWebRtcAudioTrackError(error:String){audioError("adm-playout","RUNTIME")}
            })
            .setAudioRecordStateCallback(object : JavaAudioDeviceModule.AudioRecordStateCallback {
                override fun onWebRtcAudioRecordStart() { handler.post { if (valid(token)) { recording = true; ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"adm-record","started");updateReadiness() } } }
                override fun onWebRtcAudioRecordStop() { handler.post { if (valid(token)) { recording = false; updateReadiness() } } }
            })
            .setAudioTrackStateCallback(object : JavaAudioDeviceModule.AudioTrackStateCallback {
                override fun onWebRtcAudioTrackStart() { handler.post { if (valid(token)) { playout = true; ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"adm-playout","started");updateReadiness() } } }
                override fun onWebRtcAudioTrackStop() { handler.post { if (valid(token)) { playout = false; updateReadiness() } } }
            }).createAudioDeviceModule()}
        factory = ConnectCallErrors.at("webrtc-factory","FACTORY_CREATE"){PeerConnectionFactory.builder().setAudioDeviceModule(device).createPeerConnectionFactory()}
        val config = PeerConnection.RTCConfiguration(servers).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN; continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY; bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE }
        peer = ConnectCallErrors.at("webrtc-peer","PEER_CREATE"){factory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) { if(valid(token))ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"signaling",state.name) }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) { if(valid(token))ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"ice",state.name);if (state == PeerConnection.IceConnectionState.DISCONNECTED) transport(false, token) }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) { handler.post {
                if (!valid(token)) return@post
                ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"transport",state.name)
                when (state) {
                    PeerConnection.PeerConnectionState.CONNECTED -> { val before = machine.phase; machine.transport(true); updateReadiness(before) }
                    PeerConnection.PeerConnectionState.DISCONNECTED -> transport(false, token)
                    PeerConnection.PeerConnectionState.FAILED -> end(ConnectCallState.Phase.FAILED, "Аудиосоединение потеряно")
                    else -> {}
                }
            } }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceCandidate(candidate: IceCandidate) { if (valid(token)) { localIce.add(candidate); ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"ice-local","queued") } }
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) { if (stream.audioTracks.isNotEmpty()) handler.post { if (valid(token)) { remoteAudio = true; updateReadiness() } } }
            override fun onRemoveStream(stream: MediaStream) { handler.post { if (valid(token)) { remoteAudio = false; updateReadiness() } } }
            override fun onDataChannel(channel: DataChannel) { channel.close() }
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) { if (receiver.track() is AudioTrack) handler.post { if (valid(token)) { remoteAudio = true; updateReadiness() } } }
            override fun onTrack(transceiver: RtpTransceiver) { if (transceiver.receiver.track() is AudioTrack) handler.post { if (valid(token)) { remoteAudio = true; updateReadiness() } } }
        }) ?: error("WEBRTC_UNAVAILABLE")}
        ConnectCallErrors.at("webrtc-track","TRACK_CREATE"){
            source = factory!!.createAudioSource(MediaConstraints())
            local = factory!!.createAudioTrack("connect-audio", source).apply { setEnabled(focusAvailable&&!muted) }
            check(peer!!.addTrack(local, listOf("connect-audio-stream"))!=null)
            peer!!.setAudioRecording(focusAvailable);peer!!.setAudioPlayout(focusAvailable)
        }
        ConnectCallDiagnostics.event(this,machine.id,"webrtc-peer","READY")
    }
    private fun transport(ready: Boolean, token: Int) { handler.post { if (valid(token)) { machine.transport(ready); if (!ready && activeAt > 0 && lostAt == 0L) lostAt = SystemClock.elapsedRealtime(); sounds.stopSignals(); publish(); showNotification() } } }
    private fun updateReadiness(before: ConnectCallState.Phase = machine.phase) {
        audioGate.remote=remoteAudio;audioGate.recording=recording;audioGate.playout=playout;audioGate.rtp=mediaEvidence.ready
        machine.audio(audioGate.ready)
        val evidence="${machine.connected}:$remoteAudio:$recording:$playout:$focusAvailable:${mediaEvidence.ready}"
        if(lastReadiness!=evidence){lastReadiness=evidence;ConnectCallDiagnostics.event(this,machine.id,"audio-readiness",if(audioGate.ready&&machine.connected)"READY" else "WAITING",details=mapOf("transport" to machine.connected,"remoteAudio" to remoteAudio,"recording" to recording,"playout" to playout,"focus" to focusAvailable,"rtp" to mediaEvidence.ready))}
        transition(before,"AUDIO_READINESS")
        if (machine.phase == ConnectCallState.Phase.ACTIVE) {
            lostAt = 0
            if (activeAt == 0L) { activeAt = SystemClock.elapsedRealtime(); sounds.signal(true) }
            if (before != machine.phase) { sounds.route(route, true); publish(); showNotification() }
        } else if (machine.phase == ConnectCallState.Phase.RECONNECTING) {
            if (lostAt == 0L) lostAt = SystemClock.elapsedRealtime()
            if (before != machine.phase) { publish(); showNotification() }
        }
    }
    private fun sampleMedia() {
        val connection=peer ?: return
        if(statsPending||!machine.connected||machine.terminal())return
        statsPending=true;val token=machine.revision
        connection.getStats { report -> handler.post {
            if(!valid(token))return@post
            statsPending=false
            for(stat in report.statsMap.values){
                val kind=stat.members["kind"]?:stat.members["mediaType"]
                if(kind!="audio")continue
                val packets=(stat.members[if(stat.type=="inbound-rtp")"packetsReceived" else "packetsSent"] as? Number)?.toLong()?:0
                mediaEvidence.observe(stat.type,packets)
            }
            if(!networkEvidenceLogged){
                val transport=report.statsMap.values.firstOrNull{it.type=="transport"&&it.members["selectedCandidatePairId"]!=null}
                val pair=report.statsMap[transport?.members?.get("selectedCandidatePairId")?.toString()]
                if(pair!=null){
                    fun kind(key:String):String{val value=report.statsMap[pair.members[key]?.toString()]?.members?.get("candidateType")?.toString();return value?.takeIf{it in listOf("relay","host","srflx","prflx")}?:"unknown"}
                    val localType=kind("localCandidateId");val remoteType=kind("remoteCandidateId")
                    val audio=report.statsMap.values.firstOrNull{it.type=="outbound-rtp"&&(it.members["kind"]?:it.members["mediaType"])=="audio"}
                    val codec=report.statsMap[audio?.members?.get("codecId")?.toString()]?.members?.get("mimeType")?.toString()?.lowercase()
                    ConnectCallDiagnostics.event(this,machine.id,"media-route","SELECTED_PAIR",if(localType=="relay"||remoteType=="relay")"RELAY_SELECTED" else "DIRECT",mapOf("localCandidateType" to localType,"remoteCandidateType" to remoteType,"audioCodec" to if(codec=="audio/opus")"OPUS" else "OTHER"))
                    networkEvidenceLogged=true
                }
            }
            if(mediaEvidence.ready&&activeAt==0L)ConnectCallDiagnostics.event(this,machine.id,"audio","BIDIRECTIONAL_RTP")
            updateReadiness()
        } }
    }
    private fun sync() {
        val current = row ?: return
        if (polling || machine.terminal()) return
        polling = true; val token = machine.revision; val id = current.getString("id")
        worker.execute {
            try {
                if(valid(token)&&localIce.isNotEmpty()){
                    val batch=localIce.toList().take(20);val rows=JSONArray()
                    for(candidate in batch)rows.put(JSONObject().put("call_id",id).put("sender_id",owner).put("candidate",JSONObject().put("candidate",candidate.sdp).put("sdpMid",candidate.sdpMid).put("sdpMLineIndex",candidate.sdpMLineIndex)))
                    ConnectCallSession.insertBatch(this,"/supabase/rest/v1/connect_call_ice",rows,owner)
                    if(valid(token))repeat(batch.size){localIce.poll()}
                    ConnectCallDiagnostics.event(this,id,"ice-write","ack","COUNT_${batch.size}")
                }
            }catch(_:Exception){ConnectCallDiagnostics.event(this,id,"ice-write","retry","NETWORK")}
            try {
                val fresh = JSONArray(ConnectCallSession.api(this, "/supabase/rest/v1/connect_calls?id=eq.$id&select=*&limit=1")).optJSONObject(0)
                if (fresh == null) { handler.post { if (valid(token)) end(ConnectCallState.Phase.ENDED, notifyServer = false) }; return@execute }
                handler.post { if (valid(token)) updated(fresh) }
                val items = try { JSONArray(ConnectCallSession.api(this, "/supabase/rest/v1/connect_call_ice?call_id=eq.$id&sender_id=neq.$owner&id=gt.$lastRemoteIceId&order=id.asc&limit=250")) } catch (_: Exception) { ConnectCallDiagnostics.event(this,id,"ice-read","retry","NETWORK"); JSONArray() }
                handler.post { if (valid(token)) for (i in 0 until items.length()) {
                    val item = items.optJSONObject(i) ?: continue; val candidateId = item.optLong("id"); lastRemoteIceId = maxOf(lastRemoteIceId,candidateId)
                    if (item.optString("sender_id") == owner || !knownIce.add(candidateId)) continue
                    val ice = item.optJSONObject("candidate") ?: continue; val value = ice.optString("candidate")
                    if (value.isBlank() || value.length > 16384) continue
                    val candidate = IceCandidate(ice.optString("sdpMid").takeUnless { it == "null" || it.isEmpty() }?.take(128), ice.optInt("sdpMLineIndex", 0), value)
                    try { if (remoteSet) peer?.addIceCandidate(candidate) else remoteIce.add(candidate) } catch (_: Exception) { android.util.Log.w("ConnectCall","ICE_INVALID") }
                } }

            } catch (_: Exception) { ConnectCallDiagnostics.event(this,id,"sync","retry","NETWORK"); /* Keep queued ICE until server acknowledgement. */ }
            finally { handler.post { if (valid(token)) polling = false } }
        }
    }
    private fun updated(fresh: JSONObject) {
        val status = fresh.optString("status")
        if (status !in listOf("ringing", "active")) {
            val result = when (status) { "declined" -> ConnectCallState.Phase.DECLINED; "busy" -> ConnectCallState.Phase.BUSY; "missed" -> if(incoming)ConnectCallState.Phase.MISSED else ConnectCallState.Phase.NO_ANSWER; "failed" -> ConnectCallState.Phase.FAILED; "ended" -> if(fresh.isNull("answered_at"))ConnectCallState.Phase.CANCELLED else ConnectCallState.Phase.ENDED; else -> ConnectCallState.Phase.ENDED }
            end(result, notifyServer = false,source="SERVER"); return
        }
        if (incoming && status == "active" && !machine.ownsAnswer(fresh.optJSONObject("answer")?.optString("sdp"))) { end(ConnectCallState.Phase.ENDED, "Звонок принят на другом устройстве", false,"OTHER_DEVICE"); return }
        row = fresh
        if (!incoming && status == "active") {
            val wasRinging = machine.phase == ConnectCallState.Phase.REMOTE_RINGING
            if (wasRinging) { sounds.stopSignals(); val before=machine.phase;machine.answered();ConnectCallConnectionService.answered(machine.id);transition(before,"SERVER_ANSWERED"); setupAt = SystemClock.elapsedRealtime(); publish(); showNotification() }
            if (!remoteSet && !answerApplying && fresh.optJSONObject("answer") != null) {
                answerApplying = true
                val answer = fresh.getJSONObject("answer"); val token = machine.revision
                try{checkAudioSdp(answer.getString("sdp"))}catch(_:Exception){end(ConnectCallState.Phase.FAILED,"Поддерживаются только аудиозвонки");return}
                peer?.setRemoteDescription(sdp(token) { remoteSet = true; answerApplying = false; flushRemote(); updateReadiness() }, SessionDescription(SessionDescription.Type.ANSWER, answer.getString("sdp")))
            }
        }
    }
    private fun checkAudioSdp(sdp:String){require(sdp.length in 20..65000&&sdp.lineSequence().any{it.startsWith("m=audio ")}&&sdp.lineSequence().none{it.startsWith("m=video ")})}
    private fun flushRemote() { for (candidate in remoteIce)try{peer?.addIceCandidate(candidate)}catch(_:Exception){ConnectCallDiagnostics.event(this,machine.id,"ice","rejected","INVALID")}; remoteIce.clear() }
    private fun sdp(token: Int, created: (SessionDescription) -> Unit) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) { handler.post { if (valid(token)) try { created(description) } catch (error: Exception) { failedOperation(error,"sdp","SDP_CALLBACK") } } }
        override fun onSetSuccess() { handler.post { if (valid(token)) try { created(SessionDescription(SessionDescription.Type.OFFER, "")) } catch (error: Exception) { failedOperation(error,"sdp","SDP_CALLBACK") } } }
        override fun onCreateFailure(error: String) { handler.post { if (valid(token)) {ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"sdp","FAILED","CREATE_DESCRIPTION");end(ConnectCallState.Phase.FAILED,"Не удалось согласовать аудиосоединение",source="SDP_CREATE")} } }
        override fun onSetFailure(error: String) { handler.post { if(valid(token)){ConnectCallDiagnostics.event(this@ConnectCallService,machine.id,"sdp","FAILED","SET_DESCRIPTION");end(ConnectCallState.Phase.FAILED,"Не удалось применить описание аудиосоединения",source="SDP_SET")} } }
    }
    private fun <T> network(token: Int, operation: () -> T, orphan: ((T) -> Unit)? = null, done: (T) -> Unit) {
        worker.execute {
            if(!valid(token))return@execute
            try { val result = operation(); handler.post {
                if (!valid(token)) { orphan?.invoke(result); return@post }
                try { done(result) } catch (error: Exception) { failedOperation(error,"native-callback","CALLBACK") }
            } } catch (error: Exception) { handler.post { if (valid(token)) {
                if (error is RemoteCallDone) end(ConnectCallState.Phase.ENDED, if (error.status == "active") "Звонок принят на другом устройстве" else "Вызов завершён", false)
                else failedOperation(error,"network",if(error is ConnectCallSession.HttpFailure)"HTTP_${error.status}" else "NETWORK")
            } } }
        }
    }
    private fun failedOperation(error:Exception,stage:String,code:String){
        val failure=error as? ConnectCallFailure
        val actualStage=failure?.stage?:stage;val actualCode=failure?.code?:code
        ConnectCallDiagnostics.exception(this,machine.id,actualStage,actualCode,error)
        end(ConnectCallState.Phase.FAILED,ConnectCallErrors.message(actualStage),source=actualCode)
    }
    private fun iceServers(): List<PeerConnection.IceServer> {
        try {
            val response = JSONObject(ConnectCallSession.api(this, "/api/calls/ice")).optJSONArray("iceServers") ?: JSONArray()
            val servers = mutableListOf<PeerConnection.IceServer>()
            for (i in 0 until response.length()) {
                val item = response.getJSONObject(i); val urls = item.opt("urls")
                val values = if (urls is JSONArray) (0 until urls.length()).map { urls.getString(it) } else listOf(urls.toString())
                servers.add(PeerConnection.IceServer.builder(values).setUsername(item.optString("username")).setPassword(item.optString("credential")).createIceServer())
            }
            if (servers.isNotEmpty()) {ConnectCallDiagnostics.event(this,machine.id,"ice-config","ready",if(servers.any{it.urls.any{url->url.startsWith("turn:")||url.startsWith("turns:")}})"TURN" else "STUN_ONLY");return servers}
        } catch (_: Exception) { android.util.Log.w("ConnectCall", "TURN_CONFIGURATION_UNAVAILABLE") }
        return listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
    }
    private fun notifyIncoming(id:String,user:String,attempt:Int=0){
        if(!owns(id)||machine.phase!=ConnectCallState.Phase.REMOTE_RINGING)return
        ConnectCallSession.network.execute{
            var delivered=false
            try{
                val info=JSONObject(ConnectCallSession.api(this,"/api/push/call",JSONObject().put("callId",id),expectedOwner=user))
                delivered=info.optInt("sent")>0||info.optBoolean("duplicate")||info.optBoolean("ignored")
                ConnectCallDiagnostics.event(this,id,"push",if(delivered)"accepted" else "retry","ATTEMPT_${attempt+1}")
            }catch(_:Exception){ConnectCallDiagnostics.event(this,id,"push","retry","NETWORK")}
            if(!delivered&&attempt<2)handler.postDelayed({notifyIncoming(id,user,attempt+1)},1500L*(attempt+1))
        }
    }
    private fun telecom(isIncoming: Boolean) {
        try {
            val manager = getSystemService(TelecomManager::class.java); val account = ConnectCallConnectionService.account(this)
            val extras = Bundle().apply { putString("connectCallId", machine.id); putString("connectName", name) }
            if (isIncoming) manager.addNewIncomingCall(account, extras)
            else manager.placeCall(android.net.Uri.fromParts("sip", machine.id, null), Bundle().apply { putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, account); putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, extras) })
        } catch (_: Exception) { android.util.Log.w("ConnectCall", "TELECOM_UNAVAILABLE") }
    }
    private fun applyFocus(available:Boolean){
        val before=machine.phase
        audioGate.focus(available)
        ConnectCallDiagnostics.event(this,machine.id,"focus",if(available)"GAIN" else "TRANSIENT","TELECOM")
        if(!available){sounds.stopSignals();recording=false;playout=false;mediaEvidence.pause()}
        local?.setEnabled(available&&!muted)
        peer?.setAudioRecording(available);peer?.setAudioPlayout(available)
        updateReadiness(before)
    }
    private fun applyAudioState(id: String, state: CallAudioState) {
        if (id != machine.id || machine.terminal()) return
        route = state.route; supportedRoutes = state.supportedRouteMask
        if(telecomMuted!=state.isMuted){telecomMuted=state.isMuted;muted=state.isMuted};local?.setEnabled(focusAvailable&&!muted); sounds.route(route, machine.phase == ConnectCallState.Phase.ACTIVE); publish()
    }
    private fun preferredRoute() = when {
        supportedRoutes and CallAudioState.ROUTE_BLUETOOTH != 0 -> CallAudioState.ROUTE_BLUETOOTH
        supportedRoutes and CallAudioState.ROUTE_WIRED_HEADSET != 0 -> CallAudioState.ROUTE_WIRED_HEADSET
        else -> CallAudioState.ROUTE_EARPIECE
    }
    private fun selectRoute(selected: Int) {
        if (selected and supportedRoutes == 0) return
        val connection = ConnectCallConnectionService.get(machine.id)
        if (connection != null) connection.setAudioRoute(selected)
        else getSystemService(AudioManager::class.java).isSpeakerphoneOn = selected == CallAudioState.ROUTE_SPEAKER
        route = selected; sounds.route(route, machine.phase == ConnectCallState.Phase.ACTIVE); publish()
    }
    private fun holdWake() { wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Connect:audio-call").apply { acquire(10 * 60 * 1000L) } }
    private fun resolveProfile(id: String) {
        val token = machine.revision
        worker.execute { try {
            val profile = JSONArray(ConnectCallSession.api(this, "/supabase/rest/v1/profiles?id=eq.$id&select=display_name,avatar_path&limit=1")).optJSONObject(0) ?: return@execute
            var url = ""; val path = profile.optString("avatar_path").takeUnless { it == "null" }
            if (!path.isNullOrEmpty()) {
                val encoded = path.split('/').joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
                val signed = JSONObject(ConnectCallSession.api(this, "/supabase/storage/v1/object/sign/connect-avatars/$encoded", JSONObject().put("expiresIn", 3600)))
                val relative = signed.optString("signedURL"); if (relative.startsWith("/object/sign/")) url = ConnectCallSession.BASE + "/supabase/storage/v1" + relative
            }
            handler.post { if (valid(token)) { name = profile.optString("display_name", name).take(160); avatar = url; publish(); showNotification() } }
        } catch (_: Exception) {} }
    }
    private fun retryPendingFinishes(){
        val prefs=getSharedPreferences("connect_call_pending",0)
        try {val user=ConnectCallSession.owner(this)
            for((id,value)in prefs.all.entries.take(20)){
                val item=try{JSONObject(value as String)}catch(_:Exception){continue}
                if(item.optString("owner")!=user)continue
                try{finishRequest(id,item);prefs.edit().remove(id).apply()}catch(_:Exception){}
            }
        }catch(_:Exception){}
    }
    private fun finishRequest(id:String,item:JSONObject){
        val guarded=item.optBoolean("guardOwner")
        val body=JSONObject().put("p_call_id",id)
        body.put("p_reason",item.getString("reason"))
        if(guarded)body.put("p_answer_sha256",item.optString("answerHash").takeIf{it.isNotEmpty()}?:JSONObject.NULL)
        val response=JSONObject(ConnectCallSession.api(this,"/supabase/rest/v1/rpc/"+if(guarded)"connect_finish_owned_audio_call" else "connect_finish_audio_call",body,expectedOwner=item.getString("owner")))
        // An active response means another device owns the answer: never send its end push.
        if(response.optString("status") !in listOf("ringing","active"))try{ConnectCallSession.api(this,"/api/push/call/end",JSONObject().put("callId",id),expectedOwner=item.getString("owner"))}catch(_:Exception){}
    }
    private fun finishServer(id: String, reason: String, user: String = owner, expectedAnswerHash:String?=null,guardOwner:Boolean=false) {
        if (id.isEmpty()) return
        val prefs = getSharedPreferences("connect_call_pending", 0)
        val item=JSONObject().put("owner", user).put("reason", reason).put("guardOwner",guardOwner)
        if(expectedAnswerHash!=null)item.put("answerHash",expectedAnswerHash)
        prefs.edit().putString(id,item.toString()).apply()
        ConnectCallSession.network.execute { try {
            if (ConnectCallSession.owner(this) != user) return@execute
            finishRequest(id,item)
            prefs.edit().remove(id).apply()
        } catch (_: Exception) { android.util.Log.w("ConnectCall", "FINISH_RETRY_PENDING") } }
    }
    private fun end(result: ConnectCallState.Phase, problem: String = "", notifyServer: Boolean = true,source:String="EXCEPTION") {
        val id = row?.optString("id") ?: ""
        ConnectCallIngress.acknowledge(this,machine.id)
        val acceptedHere = row?.optString("status")=="active" && machine.ownsAnswer(row?.optJSONObject("answer")?.optString("sdp"))
        val finishWitness = if(incoming)machine.answerFingerprint() else null
        val before=machine.phase
        if (!machine.end(result)) { stopIfIdle(); return }
        incomingGate.terminal(machine.id,SystemClock.elapsedRealtime());transition(before,source)
        ConnectCallDiagnostics.event(this,id,"finish",result.name,if(notifyServer)"LOCAL" else "SERVER",mapOf("source" to source,"deadlineElapsedMs" to ringDeadline,"remainingMs" to if(ringDeadline>0)ringDeadline-SystemClock.elapsedRealtime()else 0))
        ConnectCallOperations.complete(operationId,null,problem.ifBlank{"Подготовка вызова прервана"})
        tick?.let{handler.removeCallbacks(it)};tick=null
        if(problem.isNotBlank())android.widget.Toast.makeText(this,problem,android.widget.Toast.LENGTH_LONG).show()
        val failed=ConnectCallCleanup.run(listOf(
            "SIGNALS_FOCUS" to {sounds.release()},
            "PEER_CLOSE" to {peer?.close();Unit},"PEER_DISPOSE" to {peer?.dispose();Unit},
            "LOCAL_TRACK" to {local?.dispose();Unit},"AUDIO_SOURCE" to {this.source?.dispose();Unit},
            "FACTORY" to {factory?.dispose();Unit},"AUDIO_DEVICE" to {device?.release();Unit},
            "WAKE_LOCK" to {if(wake?.isHeld==true)wake?.release();Unit},
            "TELECOM" to {ConnectCallConnectionService.close(machine.id,if(result==ConnectCallState.Phase.DECLINED)DisconnectCause.REJECTED else DisconnectCause.LOCAL)}
        ))
        peer=null;local=null;this.source=null;factory=null;device=null;wake=null
        localIce.clear();remoteIce.clear();knownIce.clear();lastRemoteIceId=0;polling=false;remoteSet=false;answerApplying=false;accepting=false
        ConnectCallDiagnostics.event(this,machine.id,"cleanup",if(failed.isEmpty())"DONE" else "PARTIAL","",mapOf("failedResources" to failed.joinToString(":")))
        val prefs = getSharedPreferences("connect_incoming", 0)
        prefs.edit().putLong("ended:${machine.id}", System.currentTimeMillis()).remove("id").apply()
        prefs.all.filter { it.key.startsWith("ended:") && (it.value as? Long ?: 0) < System.currentTimeMillis() - 86400000 }.forEach { prefs.edit().remove(it.key).apply() }
        sendBroadcast(Intent(ConnectIncomingCallActivity.DISMISS).setPackage(packageName).putExtra("callId", machine.id).putExtra("presentationId",operationId.ifBlank{machine.id}))
        sequence++
        last = view().put("notice", problem.ifBlank { when (result) { ConnectCallState.Phase.BUSY -> "Собеседник занят"; ConnectCallState.Phase.DECLINED -> "Звонок отклонён"; ConnectCallState.Phase.MISSED -> "Пропущенный входящий";ConnectCallState.Phase.NO_ANSWER->"Без ответа"; ConnectCallState.Phase.FAILED -> "Не удалось установить аудиосоединение"; ConnectCallState.Phase.CANCELLED -> "Вызов отменён"; else -> "" } })
        notifyObserver(last)
        if (notifyServer) finishServer(id, ConnectCallErrors.reason(result),expectedAnswerHash=finishWitness,guardOwner=incoming&&!acceptedHere&&result !in listOf(ConnectCallState.Phase.DECLINED,ConnectCallState.Phase.BUSY,ConnectCallState.Phase.MISSED))
        stopForeground(STOP_FOREGROUND_REMOVE); getSystemService(NotificationManager::class.java).cancel(NOTIFICATION); val revision = machine.revision; handler.postDelayed({ if (machine.terminal() && machine.revision == revision && verifying.isEmpty()) stopSelf() }, 250)
    }
    private fun view(): JSONObject {
        val terminal = machine.terminal() || machine.phase == ConnectCallState.Phase.IDLE
        val phase = if (terminal) "idle" else when(machine.phase){ConnectCallState.Phase.REMOTE_RINGING->"ringing";ConnectCallState.Phase.PRESENTING->"incoming";ConnectCallState.Phase.OFFER_CREATED->"preparing";ConnectCallState.Phase.ANSWERING->"connecting";else->machine.phase.name.lowercase()}
        val shown = row?.let { current -> JSONObject().apply { for (key in listOf("id","caller_id","callee_id","conversation_id","status","created_at","answered_at")) put(key,current.opt(key)) } }
        return JSONObject().put("presentationId",operationId.ifBlank{machine.id}).put("sequence",sequence).put("phase", phase).put("state", machine.phase.name).put("callId", machine.id).put("userId", owner).put("remoteName", name).put("remoteId", peerId).put("remoteAvatar", avatar)
            .put("muted", muted).put("speaker", route == CallAudioState.ROUTE_SPEAKER).put("route", route).put("supportedRoutes", supportedRoutes)
            .put("audioOutput", when (route) { CallAudioState.ROUTE_BLUETOOTH -> "Bluetooth"; CallAudioState.ROUTE_WIRED_HEADSET -> "Проводная гарнитура"; CallAudioState.ROUTE_SPEAKER -> "Динамик"; else -> "Телефон" })
            .put("elapsed", if (activeAt == 0L) 0 else ((SystemClock.elapsedRealtime() - activeAt) / 1000).toInt()).put("error", "")
            .put("shown", shown)
    }
    private fun notifyObserver(value:JSONObject){try{observer?.invoke(JSONObject(value.toString()))}catch(_:Exception){ConnectCallDiagnostics.event(this,machine.id,"presentation","failed","REACT_OBSERVER")}}
    private fun publish() {
        sequence++
        val value = view(); last = value
        val phase = value.getString("phase"); val now = System.currentTimeMillis()
        getSharedPreferences("connect_incoming", 0).edit().putString("id", machine.id).putString("presentationId",operationId.ifBlank{machine.id}).putString("name", name).putString("avatar", avatar).putString("phase", phase)
            .putBoolean("muted", muted).putBoolean("speaker", route == CallAudioState.ROUTE_SPEAKER).putString("route", value.getString("audioOutput"))
            .putLong("startedElapsed", activeAt).putLong("started", now - value.getInt("elapsed") * 1000L).putString("problem", "")
            .putLong("expires", if (phase == "incoming") now + (ringDeadline - SystemClock.elapsedRealtime()).coerceAtLeast(1) else now + 86400000).apply()
        sendBroadcast(Intent(ConnectIncomingCallActivity.STATE).setPackage(packageName).putExtra("callId", machine.id).putExtra("presentationId",operationId.ifBlank{machine.id})); notifyObserver(value)
    }
    private fun notification(ringing: Boolean): Notification {
        val open = PendingIntent.getActivity(this, 51, ConnectCallScreen.intent(this,machine.id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val label = when (machine.phase) { ConnectCallState.Phase.PRESENTING,ConnectCallState.Phase.INCOMING -> "Входящий аудиозвонок"; ConnectCallState.Phase.ACTIVE -> "Идёт аудиозвонок"; ConnectCallState.Phase.RECONNECTING -> "Восстановление соединения…"; ConnectCallState.Phase.REMOTE_RINGING -> "Вызываем…"; ConnectCallState.Phase.CONNECTING -> "Соединяем…"; else -> "Connect · Аудиозвонок" }
        val verified=machine.phase!=ConnectCallState.Phase.IDLE&&!machine.terminal()
        val builder = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_launcher_monochrome).setContentTitle(if (!verified||owner.isEmpty()) "Connect" else name)
            .setContentText(label).setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_HIGH).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(open).setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(!ringing || incomingPosted)
        if (ringing) {
            builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(Person.Builder().setName(name).setImportant(true).build(), pending(this, "decline", machine.id), pending(this, "answer", machine.id)))
            builder.setTimeoutAfter((ringDeadline - SystemClock.elapsedRealtime()).coerceAtLeast(1))
            if (Build.VERSION.SDK_INT < 34 || getSystemService(NotificationManager::class.java).canUseFullScreenIntent()) { builder.setFullScreenIntent(open, true);if(!incomingPosted)ConnectCallDiagnostics.event(this,machine.id,"presentation","FULL_SCREEN_INTENT_REQUESTED") }
            else if(!incomingPosted)ConnectCallDiagnostics.event(this,machine.id,"notification","heads-up","FULL_SCREEN_DENIED")
        } else if (verified&&owner.isNotEmpty()) builder.setStyle(NotificationCompat.CallStyle.forOngoingCall(Person.Builder().setName(name).build(), pending(this, "end", machine.id)))
        return builder.build()
    }
    private fun showNotification(){
        val ringing=machine.phase in listOf(ConnectCallState.Phase.PRESENTING,ConnectCallState.Phase.INCOMING)
        val manager=getSystemService(NotificationManager::class.java)
        val importance=manager.getNotificationChannel(CHANNEL)?.importance?:NotificationManager.IMPORTANCE_NONE
        val code=when{!manager.areNotificationsEnabled()->"NOTIFICATIONS_DISABLED";importance<NotificationManager.IMPORTANCE_HIGH->"CHANNEL_NOT_HIGH";Build.VERSION.SDK_INT>=34&&!manager.canUseFullScreenIntent()->"FULL_SCREEN_DENIED";else->"FULL_SCREEN_REQUESTED"}
        try{
            manager.notify(NOTIFICATION,notification(ringing))
            if(ringing&&!incomingPosted)ConnectCallDiagnostics.event(this,machine.id,"presentation",if(manager.activeNotifications.any{it.id==NOTIFICATION})"NOTIFICATION_POSTED" else "PRESENTATION_DENIED",code,mapOf("notificationsEnabled" to manager.areNotificationsEnabled(),"channelImportance" to importance,"fullScreenAllowed" to (Build.VERSION.SDK_INT<34||manager.canUseFullScreenIntent()),"keyguardLocked" to getSystemService(KeyguardManager::class.java).isKeyguardLocked))
            if(ringing)incomingPosted=true
        }catch(_:SecurityException){ConnectCallDiagnostics.event(this,machine.id,"presentation","failed","NOTIFICATION_PERMISSION")}
        catch(_:Exception){ConnectCallDiagnostics.event(this,machine.id,"presentation","failed","NOTIFICATION_EXCEPTION")}
    }
    private fun stopIfIdle() { if (verifying.isEmpty() && (machine.phase == ConnectCallState.Phase.IDLE || machine.terminal())) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() } }
    override fun onTaskRemoved(rootIntent: Intent?) { /* Removing Recents is not hangup; the native service owns the call. */ super.onTaskRemoved(rootIntent) }
    override fun onDestroy() {
        destroyed = true
        if (!machine.terminal() && machine.phase != ConnectCallState.Phase.IDLE) end(ConnectCallState.Phase.FAILED, "Служба вызова остановлена")
        handler.removeCallbacksAndMessages(null); sounds.release(); worker.shutdownNow(); if (instance === this) instance = null; super.onDestroy()
    }
}
