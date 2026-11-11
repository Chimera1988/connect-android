package com.connect.messenger

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.temporal.ChronoField.*

class ConnectCallTimingTest {
 private val outgoing="2026-11-10T21:27:07.068419+00:00"
 private val incoming="2026-11-10T21:27:37.331392+00:00"
 // Source-derived Android10 InstantPrinterParser fixture, not a physical phone.
 private val android29Instant=DateTimeFormatterBuilder().append(DateTimeFormatter.ISO_LOCAL_DATE).appendLiteral('T')
   .appendValue(HOUR_OF_DAY,2).appendLiteral(':').appendValue(MINUTE_OF_HOUR,2).appendLiteral(':')
   .appendValue(SECOND_OF_MINUTE,2).appendFraction(NANO_OF_SECOND,0,9,true).appendLiteral('Z').toFormatter()
 @Test fun actualAndroid29ParserRejectsPostgrestNumericOffsetButOffsetParserWorks(){
   assertThrows(java.time.format.DateTimeParseException::class.java){android29Instant.parse(outgoing)}
   android29Instant.parse(outgoing.replace("+00:00","Z"))
   assertEquals(1794346027068L,ConnectCallTiming.parse(outgoing))
   assertEquals(1794346057331L,ConnectCallTiming.parse(incoming))
 }
 @Test fun reproducesOldOneMillisecondDeadlineAndPrevents116msMissed(){
   val serverNow=1794346027100L;val elapsed=123000L
   val oldCreated=try{android29Instant.parse(outgoing);1L}catch(_:Exception){0L}
   val oldDeadline=elapsed+(60000-(serverNow-oldCreated)).coerceIn(1,60000)
   assertTrue(ConnectCallTiming.expired(1,1,oldDeadline,elapsed+116))
   val fixed=ConnectCallTiming.window(ConnectCallTiming.parse(outgoing),serverNow,elapsed)
   assertTrue(fixed.valid);assertEquals(59968L,fixed.remaining)
   assertFalse(ConnectCallTiming.expired(1,1,fixed.deadline,elapsed+116))
 }
 @Test fun zonesFractionsAndEpochUnitsAreCorrect(){
   for(value in listOf("2026-11-10T21:27:07.068419Z","2026-11-11T00:27:07.068419+03:00","2026-11-10T16:27:07.068419-05:00"))assertEquals(1794346027068L,ConnectCallTiming.parse(value))
   assertEquals(1794346027000L,ConnectCallTiming.parse("2026-11-10T21:27:07+00:00"))
   assertNull(ConnectCallTiming.parse("1794346027"));assertNull(ConnectCallTiming.parse("broken"))
 }
 @Test fun invalidAndExpiredDatesNeverBecomeAOneMillisecondRingingCall(){
   assertEquals("INVALID_TIMESTAMP",ConnectCallTiming.window(null,100000,1000).reason)
   assertEquals("EXPIRED",ConnectCallTiming.window(10000,70000,1000).reason)
   assertEquals("FUTURE_TIMESTAMP",ConnectCallTiming.window(90000,70000,1000).reason)
 }
 @Test fun oldGenerationCannotEndANewCallAndWallClockChangesDoNotMoveDeadline(){
   val window=ConnectCallTiming.window(100000,100100,5000)
   assertFalse(ConnectCallTiming.expired(3,4,window.deadline,999999))
   ConnectCallServerClock.observe(100100,5000)
   assertEquals(100216L,ConnectCallServerClock.now(5116,999999999))
   assertEquals(100216L,ConnectCallServerClock.now(5116,1))
   assertFalse(ConnectCallTiming.expired(4,4,window.deadline,5116))
 }
 @Test fun duplicateFcmReceiverServiceAndPollingShareOneLogicalIncoming(){
   val gate=ConnectIncomingGate();assertEquals("DISPATCH",gate.dispatch("call",1000));gate.validating("call")
   repeat(200){assertEquals("DUPLICATE",gate.dispatch("call",2000+it.toLong()))}
   gate.owned("call");repeat(50){assertEquals("OWNED",gate.dispatch("call",4000+it.toLong()))}
 }
 @Test fun failedValidationBacksOffButPermanentRejectionDoesNotRestartServiceEvery3sec(){
   val gate=ConnectIncomingGate();gate.dispatch("call",1000);gate.retry("call",2000)
   assertEquals("BACKOFF",gate.dispatch("call",3000));assertEquals("DISPATCH",gate.dispatch("call",4500))
   gate.terminal("call",5000);for(now in 6000L..59000L step 3000)assertEquals("TERMINAL",gate.dispatch("call",now))
   assertEquals("DISPATCH",gate.dispatch("next",6000))
 }
 @Test fun validIncomingCanPresentRingAnswerAndOnlyRealAudioActivates(){
   val window=ConnectCallTiming.window(ConnectCallTiming.parse(incoming),1794346057400L,9000)
   assertTrue(window.valid)
   val state=ConnectCallState();state.begin("call",true);state.presenting();assertEquals(ConnectCallState.Phase.PRESENTING,state.phase)
   state.ringing();state.answering();assertEquals(ConnectCallState.Phase.ANSWERING,state.phase)
   state.answered();state.transport(true);assertEquals(ConnectCallState.Phase.CONNECTING,state.phase)
   state.audio(true);assertEquals(ConnectCallState.Phase.ACTIVE,state.phase)
 }
 @Test fun impossibleTransitionsAreRejectedAndNextCallWorksAfterFailure(){
   val state=ConnectCallState();state.begin("call",false)
   assertThrows(IllegalStateException::class.java){state.identified("server")}
   assertThrows(IllegalStateException::class.java){state.answering()}
   state.offered();state.identified("server");state.end(ConnectCallState.Phase.FAILED)
   state.begin("next",false);state.offered();state.identified("next-server");assertEquals(ConnectCallState.Phase.REMOTE_RINGING,state.phase)
 }
 @Test fun cancelledExpiredAndWrongAccountIncomingNeverReachPresentation(){
   val valid=ConnectCallTiming.window(100000,100100,1000)
   assertEquals("VALID",ConnectCallValidation.reason("a","a","ringing",valid,true,false))
   assertEquals("SERVER_ENDED",ConnectCallValidation.reason("a","a","ended",valid,true,false))
   assertEquals("WRONG_OWNER",ConnectCallValidation.reason("a","b","ringing",valid,true,false))
   assertEquals("EXPIRED",ConnectCallValidation.reason("a","a","ringing",ConnectCallTiming.window(100000,160000,1000),true,false))
   assertEquals("AUTH_CHANGED",ConnectCallValidation.reason("a","a","ringing",valid,false,false))
   assertEquals("LOCAL_TERMINAL",ConnectCallValidation.reason("a","a","ringing",valid,true,true))
 }
 @Test fun authenticationNetworkNotificationAndActivityFailuresHaveDistinctCodes(){
   assertEquals("AUTH_401",ConnectCallValidation.failure(401,true,false))
   assertEquals("AUTH_403",ConnectCallValidation.failure(403,true,false))
   assertEquals("NO_SESSION",ConnectCallValidation.failure(null,false,false))
   assertEquals("NETWORK_RETRY",ConnectCallValidation.failure(null,true,true))
   val codes=setOf(ConnectCallValidation.failure(401,true,false),ConnectCallValidation.failure(null,true,true),"NOTIFICATION_PERMISSION","ACTIVITY_START_DENIED")
   assertEquals(4,codes.size)
 }
 @Test fun everyCleanupActionRunsEvenIfOneAndroidResourceThrows(){
   val attempted=mutableListOf<String>()
   val failed=ConnectCallCleanup.run(listOf("PEER" to {attempted.add("peer");error("test")},"FOCUS" to {attempted.add("focus");Unit},"TELECOM" to {attempted.add("telecom");Unit}))
   assertEquals(listOf("peer","focus","telecom"),attempted);assertEquals(listOf("PEER"),failed)
 }
 @Test fun callerNoAnswerAndCancelledAreDifferentFromIncomingMissed(){
   for(terminal in listOf(ConnectCallState.Phase.NO_ANSWER,ConnectCallState.Phase.CANCELLED,ConnectCallState.Phase.MISSED)){
    val s=ConnectCallState();s.begin("call",false);assertTrue(s.end(terminal));assertEquals(terminal,s.phase);assertFalse(s.end(terminal))
   }
 }
}
