package com.connect.messenger

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class ConnectMessagingService : FirebaseMessagingService() {
 override fun onNewToken(token:String){ super.onNewToken(token) /* Re-register from settings after token rotation. */ }
 override fun onMessageReceived(message:RemoteMessage){
  val prefs=getSharedPreferences("connect_push",Context.MODE_PRIVATE)
  if(!prefs.getBoolean("enabled",true))return
  val sound=prefs.getString("sound","soft")?:"soft"
  val vibrate=prefs.getBoolean("vibrate",true)
  val channelId="connect_messages_${sound}_${if(vibrate) "v" else "n"}_v1"
  val manager=getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  val channel=NotificationChannel(channelId,"Connect — сообщения ($sound)",NotificationManager.IMPORTANCE_HIGH)
  if(sound=="silent")channel.setSound(null,null)
  else {
   val res=resources.getIdentifier("connect_$sound","raw",packageName)
   if(res!=0)channel.setSound(Uri.parse("android.resource://$packageName/$res"),AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
  }
  channel.enableVibration(vibrate)
  manager.createNotificationChannel(channel)
  val intent=Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  val pending=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val notification=NotificationCompat.Builder(this,channelId).setSmallIcon(R.drawable.connect_icon).setContentTitle(message.data["title"]?:"Connect").setContentText(message.data["body"]?:"Новое сообщение").setAutoCancel(true).setContentIntent(pending).setPriority(NotificationCompat.PRIORITY_HIGH).build()
  manager.notify((message.data["messageId"]?:System.currentTimeMillis().toString()).hashCode(),notification)
 }
}
