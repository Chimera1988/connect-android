package com.connect.messenger
import org.junit.Assert.*
import org.junit.Test
class ConnectMissedLedgerTest{
 @Test fun duplicateFcmCreatesOneLogicalNotificationAcrossRestart(){
  val persisted=mutableSetOf<String>();var posts=0
  repeat(2){val key=ConnectMissedLedger.notificationTag("account-a","call");if(ConnectMissedLedger.shouldPost(100,0,key in persisted,false)){posts++;persisted.add(key)}}
  assertEquals(1,posts);assertNotEquals(ConnectMissedLedger.notificationTag("account-a","call"),ConnectMissedLedger.notificationTag("account-b","call"))
 }
 @Test fun viewingClearsOnlyMissedEntriesAtOrBeforeHighWater(){
  val marker=ConnectMissedLedger.viewedMarker(10,50,listOf(40,70),true);assertEquals(70L,marker)
  assertEquals(0,ConnectMissedLedger.unseen(listOf(40,70),marker));assertFalse(ConnectMissedLedger.shouldPost(70,marker,false,false));assertTrue(ConnectMissedLedger.shouldPost(80,marker,false,false))
  assertFalse(ConnectMissedLedger.cleared(80,marker));assertEquals(50L,ConnectMissedLedger.viewedMarker(10,50,listOf(70),false))
 }
 @Test fun messageAndLiveCallCleanupCannotCollideWithMissedTag(){
  val missed=ConnectMissedLedger.notificationTag("owner","call");assertFalse(missed.startsWith("chat:"));assertFalse(missed.startsWith("connect-call:"))
  assertFalse(ConnectMissedLedger.shouldPost(100,0,false,true));assertEquals(1,ConnectMissedLedger.unseen(listOf(40,100),50))
 }
 @Test fun coldFcmReservesPersistentOsWorkBeforeReturningToAsyncValidation(){
  val events=mutableListOf<String>()
  assertTrue(ConnectMissedDelivery.enqueue({events.add("persist");true},{events.add("job")},{events.add("dispatch")}))
  assertEquals(listOf("persist","job","dispatch"),events)
 }
 @Test fun failedQueueCommitCannotPretendToHaveScheduledDurableDelivery(){
  var started=false;assertFalse(ConnectMissedDelivery.enqueue({false},{started=true},{started=true}));assertFalse(started)
 }

}
