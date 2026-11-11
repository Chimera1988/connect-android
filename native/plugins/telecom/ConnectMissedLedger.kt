package com.connect.messenger

/** Pure durable-ledger decisions used by the native FCM/notification owner. */
internal object ConnectMissedLedger {
 fun notificationTag(owner:String,id:String)="connect-missed:$owner:$id"
 fun shouldPost(at:Long,viewed:Long,posted:Boolean,viewing:Boolean)=at>viewed&&!posted&&!viewing
 fun unseen(entries:Collection<Long>,viewed:Long)=entries.count{it>viewed}
 fun viewedMarker(old:Long,requested:Long,entries:Collection<Long>,includeCurrent:Boolean)=maxOf(old,requested,if(includeCurrent)entries.maxOrNull()?:0L else 0L)
 fun cleared(at:Long,marker:Long)=at<=marker
}

/** The broadcast may end immediately: persist and reserve OS work BEFORE
 * returning to FCM, then attempt the fast in-process validation path. */
internal object ConnectMissedDelivery{
 fun enqueue(persist:()->Boolean,reserveJob:()->Unit,dispatch:()->Unit):Boolean{
  if(!persist())return false
  reserveJob();dispatch();return true
 }
}
