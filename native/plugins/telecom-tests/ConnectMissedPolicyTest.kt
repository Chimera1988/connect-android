package com.connect.messenger
import org.junit.Assert.*
import org.junit.Test
class ConnectMissedPolicyTest{
 @Test fun sharedMatrixMatchesNativeColdPushPolicy(){
  val stream=javaClass.classLoader!!.getResourceAsStream("call-missed-fixtures.tsv")!!
  val now=java.time.Instant.parse("2026-11-11T12:00:00Z").toEpochMilli();var count=0
  stream.bufferedReader().useLines{lines->lines.forEach{line->val p=line.split('\t');val actual=ConnectMissedPolicy.isMissedIncomingCall("call",p[1],p[0],p[2],p[3].takeUnless{it=="-"},p[4].takeUnless{it=="-"},"self",now);assertEquals(line,p[5].toBoolean(),actual);count++}}
  assertEquals(180,count)
 }
 @Test fun locallyAcceptedCallIsNotStaleRinging(){assertFalse(ConnectMissedPolicy.isMissedIncomingCall("active","self","ringing","2026-11-11T11:58:00Z",null,null,"self",java.time.Instant.parse("2026-11-11T12:00:00Z").toEpochMilli(),"active"))}
 @Test fun invalidEndedTimestampNeverBecomesMissed(){assertFalse(ConnectMissedPolicy.isMissedIncomingCall("call","self","ended","2026-11-11T11:58:00Z",null,"invalid","self",0))}
}
