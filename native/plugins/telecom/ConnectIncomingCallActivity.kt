package com.connect.messenger

import android.app.Activity
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.os.*
import android.view.*
import android.widget.*
import com.facebook.react.ReactApplication
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.Arguments

/** Standalone incoming AND active audio-call screen. No React root, WebView or
 * launcher theme. The native WebRTC controller only sends state/actions. */
class ConnectIncomingCallActivity:Activity(){
 companion object{const val DISMISS="com.connect.messenger.DISMISS_INCOMING";const val STATE="com.connect.messenger.CALL_STATE"; @Volatile var visible=false}
 private val handler=Handler(Looper.getMainLooper());private var callId="";private var registered=false
 private val worker=java.util.concurrent.Executors.newSingleThreadExecutor();private var avatarView:ImageView?=null;private var avatarSource=""
 private var permissionOnly=false;private var permissionShowing=false
 private var timer:TextView?=null;private var activeStarted=0L;private var callScroll:ScrollView?=null
 private val close=Runnable{finish()}
 private val ticker=object:Runnable{override fun run(){if(activeStarted>0){val seconds=((SystemClock.elapsedRealtime()-activeStarted)/1000).coerceAtLeast(0);timer?.text="Разговор · ${seconds/60}:${(seconds%60).toString().padStart(2,'0')}"};handler.postDelayed(this,1000)}}
 private val receiver=object:BroadcastReceiver(){override fun onReceive(context:Context?,intent:Intent?){if(intent?.getStringExtra("callId")!=callId)return;if(intent.action==DISMISS)finish() else{drawCall();tryAccept()}}}
 private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
 override fun onCreate(saved:Bundle?){super.onCreate(saved);setShowWhenLocked(true);setTurnScreenOn(true);window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);window.statusBarColor=Color.rgb(10,14,22);window.navigationBarColor=Color.rgb(10,14,22);val filter=IntentFilter().apply{addAction(DISMISS);addAction(STATE)};androidx.core.content.ContextCompat.registerReceiver(this,receiver,filter,androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);registered=true;drawCall();handler.post(ticker)}
 override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);drawCall();requestCallMicrophone()}
 override fun onResume(){super.onResume();visible=true;requestCallMicrophone();tryAccept()}
 private fun tryAccept(){
  val requested=intent.getStringExtra("acceptCall")
  if(!requested.isNullOrEmpty()&&requested==callId&&ConnectCallService.owns(callId)){
   intent.removeExtra("acceptCall")
   if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED)ConnectCallService.action(this,"answer",callId)
   else{intent.putExtra("acceptPermission",true);requestCallMicrophone()}
  }
 }
 override fun onPause(){visible=false;super.onPause()}
 private fun requestCallMicrophone(){
  if((ConnectCallMicrophone.pending==null&&!intent.getBooleanExtra("acceptPermission",false))||permissionShowing)return
  if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED){ConnectCallMicrophone.complete(true);if(permissionOnly)finish();return}
  permissionShowing=true;requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO),1129)
 }
 override fun onRequestPermissionsResult(code:Int,permissions:Array<out String>,results:IntArray){
  super.onRequestPermissionsResult(code,permissions,results)
  if(code!=1129)return
  permissionShowing=false;val granted=results.firstOrNull()==android.content.pm.PackageManager.PERMISSION_GRANTED
  ConnectCallMicrophone.complete(granted)
  if(intent.getBooleanExtra("acceptPermission",false)){intent.removeExtra("acceptPermission");ConnectCallService.action(this,if(granted)"answer" else "failed",callId)}
  if(!granted)Toast.makeText(this,"Для аудиозвонка нужен доступ к микрофону",Toast.LENGTH_LONG).show()
  if(permissionOnly)finish()
 }
 private fun dispatch(action:String){
  if(action=="route")ConnectCallCoordinatorModule.showRoutes(this)
  else ConnectCallService.action(this,action,callId)
 }

 private fun drawCall(){
  val state=getSharedPreferences("connect_incoming",0);callId=state.getString("id","")?:"";val expires=state.getLong("expires",0)
  if(callId.isEmpty()||expires<=System.currentTimeMillis()){
   if(ConnectCallMicrophone.pending!=null){permissionOnly=true;setContentView(TextView(this).apply{text="Connect · Доступ к микрофону для аудиозвонка";setTextColor(Color.WHITE);setBackgroundColor(Color.rgb(10,14,22));gravity=Gravity.CENTER;setPadding(dp(24),dp(32),dp(24),dp(32))});return}
   finish();return
  };permissionOnly=false
  handler.removeCallbacks(close);handler.postDelayed(close,expires-System.currentTimeMillis())
  val phase=state.getString("phase","incoming")
  if(!ConnectCallService.owns(callId)){
   if(phase=="incoming")ConnectCallService.action(this,"incoming",callId)
   else{if(phase in listOf("active","reconnecting"))ConnectCallService.action(this,"recover",callId);finish();return}
  }
  val incoming=phase=="incoming";val name=state.getString("name","Собеседник")?:"Собеседник"
  activeStarted=if(phase=="active")state.getLong("startedElapsed",SystemClock.elapsedRealtime()) else 0
  val scene=state.getString("scene","waves")?:"waves"
  val frame=FrameLayout(this);frame.addView(Waves(this,scene),FrameLayout.LayoutParams(-1,-1))
  val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER_HORIZONTAL;setPadding(dp(24),dp(24),dp(24),dp(28));fitsSystemWindows=true}
  fun text(label:String,size:Float,color:Int=Color.WHITE)=TextView(this).apply{text=label;textSize=size;setTextColor(color);gravity=Gravity.CENTER;setPadding(0,dp(8),0,dp(8))}
  root.addView(text("CONNECT",17f,Color.rgb(202,211,223)));root.addView(View(this),LinearLayout.LayoutParams(1,0,1f))
  val avatarFrame=FrameLayout(this).apply{background=glass(true);clipToOutline=true;outlineProvider=ViewOutlineProvider.BACKGROUND}
  avatarFrame.addView(text(name.trim().take(1).uppercase(),55f),FrameLayout.LayoutParams(-1,-1))
  avatarView=ImageView(this).apply{scaleType=ImageView.ScaleType.CENTER_CROP};avatarFrame.addView(avatarView,FrameLayout.LayoutParams(-1,-1))
  val avatarSize=if(resources.configuration.screenHeightDp<650)112 else 144
  root.addView(avatarFrame,LinearLayout.LayoutParams(dp(avatarSize),dp(avatarSize)))
  root.addView(text(name,26f).apply{typeface=Typeface.DEFAULT_BOLD;maxLines=3},LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(16)})
  val caption=when(phase){"incoming"->"Входящий аудиозвонок";"ringing"->"Вызываем…";"preparing"->"Подключаем микрофон…";"connecting"->"Соединяем…";"reconnecting"->"Восстановление соединения…";else->"Аудиозвонок"}
  timer=text(caption,16f,Color.rgb(202,211,223));root.addView(timer);root.addView(View(this),LinearLayout.LayoutParams(1,0,1f))
  val problem=state.getString("problem","")?:"";if(problem.isNotEmpty())root.addView(text(problem,13f,Color.rgb(255,169,181)))
  fun button(label:String,color:Int?=null,action:()->Unit)=Button(this).apply{text=label;textSize=14f;isAllCaps=false;setTextColor(Color.WHITE);minHeight=dp(if(color==null)54 else 64);maxLines=2;gravity=Gravity.CENTER;setPadding(dp(8),dp(12),dp(8),dp(12));background=if(color==null)glass(false) else GradientDrawable().apply{cornerRadius=dp(28).toFloat();setColor(color)};setOnClickListener{action()}}
  if(!incoming){val audio=LinearLayout(this).apply{gravity=Gravity.CENTER};listOf(
    button(if(state.getBoolean("muted",false))"Микрофон выкл." else "Микрофон"){dispatch("mute")},
    button(if(state.getBoolean("speaker",false))"Динамик вкл." else "Динамик"){dispatch("speaker")}
  ).forEach{audio.addView(it,LinearLayout.LayoutParams(0,-2,1f).apply{setMargins(dp(4),0,dp(4),0)})};root.addView(audio,LinearLayout.LayoutParams(-1,-2));root.addView(button(state.getString("route","")?.ifBlank{"Аудиоустройство"}?:"Аудиоустройство"){dispatch("route")},LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(10)})}
  val actions=LinearLayout(this).apply{gravity=Gravity.CENTER}
  fun incomingAction(accept:Boolean){
   ConnectCallService.action(this,if(accept)"answer" else "decline",callId)
  }

  if(incoming)actions.addView(button("Ответить",Color.rgb(32,149,108)){incomingAction(true)},LinearLayout.LayoutParams(0,-2,1f).apply{rightMargin=dp(8)})
  actions.addView(button(if(incoming)"Отклонить" else "Завершить",Color.rgb(202,57,79)){if(incoming)incomingAction(false)else dispatch("end")},LinearLayout.LayoutParams(0,-2,1f))
  root.addView(actions,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(18)})
  val savedScroll=callScroll?.scrollY?:0;val scroll=ScrollView(this).apply{isFillViewport=true;isVerticalScrollBarEnabled=false};scroll.addView(root,FrameLayout.LayoutParams(-1,-2));frame.addView(scroll,FrameLayout.LayoutParams(-1,-1));callScroll=scroll;setContentView(frame);scroll.post{scroll.scrollTo(0,savedScroll)}
  val url=state.getString("avatar","")?:"";loadAvatar(url)
 }
 private fun glass(circle:Boolean)=GradientDrawable(GradientDrawable.Orientation.TL_BR,intArrayOf(Color.argb(42,235,241,252),Color.argb(12,175,190,220))).apply{if(circle)shape=GradientDrawable.OVAL else cornerRadius=dp(24).toFloat();setStroke(dp(1),Color.argb(65,240,246,255))}
 private fun loadAvatar(url:String){if(url.isEmpty())return;avatarSource=url;val view=avatarView
  if(!url.startsWith("https://connect-chat.duckdns.org/supabase/storage/v1/object/sign/connect-avatars/"))return
  worker.execute{try{val key=java.security.MessageDigest.getInstance("SHA-256").digest(url.substringBefore('?').toByteArray()).joinToString(""){"%02x".format(it)};val directory=java.io.File(filesDir,"connect-avatars").apply{mkdirs()};val file=java.io.File(directory,key)
    if(!file.exists()){val request=java.net.URL(url).openConnection().apply{connectTimeout=4000;readTimeout=4000};val out=java.io.ByteArrayOutputStream();request.getInputStream().use{input->val chunk=ByteArray(8192);while(true){val n=input.read(chunk);if(n<0)break;if(out.size()+n>2*1024*1024)throw IllegalArgumentException("Avatar too large");out.write(chunk,0,n)}};file.writeBytes(out.toByteArray());var retained=0L;directory.listFiles()?.sortedByDescending{it.lastModified()}?.forEachIndexed{index,item->retained+=item.length();if(index>=100||retained>64*1024*1024)item.delete()}}
    file.setLastModified(System.currentTimeMillis());val bitmap=BitmapFactory.decodeFile(file.path,BitmapFactory.Options().apply{inSampleSize=2});handler.post{if(!isDestroyed&&avatarSource==url&&view===avatarView)view?.setImageBitmap(bitmap)}
   }catch(_:Exception){/* Initial remains visible. */}}
 }
 override fun onDestroy(){if(isFinishing&&permissionShowing)ConnectCallMicrophone.complete(false);handler.removeCallbacksAndMessages(null);if(registered)unregisterReceiver(receiver);worker.shutdownNow();super.onDestroy()}
 private class Waves(context:Context,val scene:String):View(context){private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas:Canvas){super.onDraw(canvas);val w=width.toFloat();val h=height.toFloat();val accent=when(scene){"sunset"->Color.rgb(135,77,74);"lagoon"->Color.rgb(38,104,106);"nebula"->Color.rgb(99,65,130);"aurora"->Color.rgb(58,102,108);"moon"->Color.rgb(79,91,124);else->Color.rgb(72,88,110)};paint.shader=LinearGradient(0f,0f,w,h,intArrayOf(Color.rgb(18,24,34),Color.rgb(8,12,19),Color.rgb(26,32,43)),null,Shader.TileMode.CLAMP);canvas.drawRect(0f,0f,w,h,paint);paint.shader=null;if(scene=="minimal")return;paint.style=Paint.Style.STROKE;paint.strokeWidth=1.5f*resources.displayMetrics.density;for(i in 0..7){paint.color=accent;paint.alpha=45+i*9;val path=Path();path.moveTo(-w*.2f,h*(.45f+i*.027f));path.cubicTo(w*.2f,h*.1f,w*.55f,h*.9f,w*1.2f,h*(.38f+i*.045f));canvas.drawPath(path,paint)};paint.style=Paint.Style.FILL}
 }
}
