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
            else settings(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,packageName))
        }
        if(Build.VERSION.SDK_INT>=34){
            text(if(notifications.canUseFullScreenIntent())"Входящий на блокировке: полноэкранный показ разрешён" else "Полноэкранный показ отключён. Пока доступно уведомление с кнопками.")
            if(!notifications.canUseFullScreenIntent())button("Разрешить экран входящего звонка"){settings(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:$packageName")))}
        }
        try{ConnectCallConnectionService.account(this);text("Android Telecom: зарегистрирован")}
        catch(_:Exception){text("Android Telecom недоступен: проверьте настройки звонков Android")}
        val prefs=getSharedPreferences("connect_call_settings",0)
        val vibrate=Switch(this).apply{text="Вибрация входящего звонка";setTextColor(Color.WHITE);isChecked=prefs.getBoolean("callVibrationV2",true);setOnCheckedChangeListener{_,value->prefs.edit().putBoolean("callVibrationV2",value).putBoolean("vibrate",value).apply()}}
        root.addView(vibrate)
        text("Звук по умолчанию: Connect Call. Своя мелодия выбирается в настройках Connect. Беззвучный режим и «Не беспокоить» Android имеют приоритет.")
        text("На Poco / MIUI проверьте разрешение автозапуска, уведомления на экране блокировки и ограничение фоновой работы Connect. Android не позволяет приложению самостоятельно включить эти параметры.")
        button("Открыть настройки Connect в Android"){settings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))}
        button("Сохранить диагностику звонков"){ConnectCallDiagnostics.export(this)}
        button("Готово"){prefs.edit().putInt("setupVersion",14).apply();finish()}
        setContentView(ScrollView(this).apply{isFillViewport=true;addView(root)})
    }
    override fun onRequestPermissionsResult(code:Int,permissions:Array<out String>,results:IntArray){super.onRequestPermissionsResult(code,permissions,results);draw()}
}
