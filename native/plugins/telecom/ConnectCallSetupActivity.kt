package com.connect.messenger

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.widget.*

/** User-visible preparation; never launched by an incoming background push. */
class ConnectCallSetupActivity:Activity(){
    override fun onCreate(saved:Bundle?){super.onCreate(saved);draw()}
    override fun onResume(){super.onResume();draw()}
    private fun has(name:String)=checkSelfPermission(name)==PackageManager.PERMISSION_GRANTED
    private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
    private fun settings(intent:Intent){try{startActivity(intent)}catch(_:Exception){Toast.makeText(this,"Откройте настройки приложения Connect в Android",Toast.LENGTH_LONG).show()}}
    private fun draw(){
        ConnectCallService.ensureChannels(this)
        val notifications=getSystemService(NotificationManager::class.java)
        val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(24),dp(36),dp(24),dp(24));setBackgroundColor(Color.rgb(14,23,37))}
        fun text(label:String,size:Float=15f){root.addView(TextView(this).apply{text=label;textSize=size;setTextColor(Color.WHITE);setPadding(0,dp(10),0,dp(10))})}
        fun button(label:String,action:()->Unit){root.addView(Button(this).apply{text=label;isAllCaps=false;setOnClickListener{action()}},LinearLayout.LayoutParams(-1,-2))}
        text("Connect · Подготовка звонков",23f)
        text("Звонки работают через нативную службу Android. Разрешения ниже нужны для микрофона и входящего вызова при блокировке.")
        text(if(has(Manifest.permission.RECORD_AUDIO))"Микрофон: разрешён" else "Микрофон: нужен доступ")
        if(!has(Manifest.permission.RECORD_AUDIO))button("Разрешить микрофон"){
            if(getPreferences(0).getBoolean("askedMic",false)&&!shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO))settings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))
            else{getPreferences(0).edit().putBoolean("askedMic",true).apply();requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO),41)}
        }
        text(if(notifications.areNotificationsEnabled())"Уведомления: разрешены" else "Уведомления: отключены в Android")
        button("Настроить уведомления звонков"){
            if(Build.VERSION.SDK_INT>=33&&!has(Manifest.permission.POST_NOTIFICATIONS))requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),42)
            else settings(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,packageName).putExtra(Settings.EXTRA_CHANNEL_ID,ConnectCallService.CHANNEL))
        }
        val channel=notifications.getNotificationChannel(ConnectCallService.CHANNEL)
        text(when{channel==null->"Канал звонков будет создан при первом вызове";channel.importance<NotificationManager.IMPORTANCE_HIGH->"Канал звонков: включите высокую важность и показ на блокировке";else->"Канал звонков: высокая важность"})
        val audio=getSystemService(android.media.AudioManager::class.java)
        text("Громкость звонка: ${audio.getStreamVolume(android.media.AudioManager.STREAM_RING)}. Режим: "+when(audio.ringerMode){0->"без звука";1->"вибрация";else->"звук"})
        if(notifications.currentInterruptionFilter!=NotificationManager.INTERRUPTION_FILTER_ALL)text("Включено «Не беспокоить»: оповещение определяется политикой Android")
        if(Build.VERSION.SDK_INT>=34){
            text(if(notifications.canUseFullScreenIntent())"Входящий на блокировке: полноэкранный показ разрешён" else "Полноэкранный показ отключён. Пока доступно уведомление с кнопками.")
            if(!notifications.canUseFullScreenIntent())button("Разрешить экран входящего звонка"){settings(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:$packageName")))}
        }
        try{
            val telecom=getSystemService(android.telecom.TelecomManager::class.java)
            val handle=ConnectCallConnectionService.account(this)
            text(if(telecom.getPhoneAccount(handle)!=null)"Android Telecom: учётная запись зарегистрирована" else "Android Telecom: регистрация не подтверждена")
            text(if(telecom.isIncomingCallPermitted(handle))"Android разрешает новый входящий вызов" else "Сейчас Android ограничивает новый входящий: возможен другой системный разговор")
        }
        catch(_:Exception){text("Android Telecom недоступен: проверьте настройки звонков Android")}
        val power=getSystemService(PowerManager::class.java)
        text(if(power.isIgnoringBatteryOptimizations(packageName))"Фоновая работа: исключение из оптимизации батареи включено" else "Фоновая работа ограничивается настройками Android; при задержках проверьте оптимизацию батареи")
        button("Настройки фоновой работы и батареи"){settings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))}
        val prefs=getSharedPreferences("connect_call_settings",0)
        val vibrate=Switch(this).apply{text="Вибрация входящего звонка";setTextColor(Color.WHITE);isChecked=prefs.getBoolean("callVibrationV2",true);setOnCheckedChangeListener{_,value->prefs.edit().putBoolean("callVibrationV2",value).putBoolean("vibrate",value).apply()}}
        root.addView(vibrate)
        val signal=ConnectCallAudio(this)
        text("Проверка вибрации: "+when(signal.vibrationPolicy()){"ALLOWED_SYSTEM_POLICY"->"запрос разрешён, итог определяет Android";"CONNECT_VIBRATION_OFF"->"выключена в Connect";"NO_VIBRATOR"->"вибромотор отсутствует";"RINGER_SILENT"->"режим без звука";"SYSTEM_RING_VIBRATION_OFF","SYSTEM_RING_INTENSITY_OFF"->"выключена в настройках звонков телефона";else->"определяется политикой Android"})
        if(prefs.getString("ringWarning",null)=="CUSTOM_UNAVAILABLE")text("Выбранный файл мелодии недоступен. Для оповещения используется Connect Call; выберите файл снова в настройках звука Connect.")
        text("Звук по умолчанию: Connect Call. Своя мелодия выбирается в настройках Connect. Беззвучный режим и «Не беспокоить» Android имеют приоритет.")
        text("На Poco / MIUI проверьте разрешение автозапуска, уведомления на экране блокировки и ограничение фоновой работы Connect. Android не позволяет приложению самостоятельно включить эти параметры.")
        button("Открыть настройки Connect в Android"){settings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))}
        button("Сохранить диагностику звонков"){ConnectCallDiagnostics.export(this)}
        button("Готово"){prefs.edit().putInt("setupVersion",17).apply();finish()}
        setContentView(ScrollView(this).apply{isFillViewport=true;addView(root)})
    }
    override fun onRequestPermissionsResult(code:Int,permissions:Array<out String>,results:IntArray){super.onRequestPermissionsResult(code,permissions,results);draw()}
}
