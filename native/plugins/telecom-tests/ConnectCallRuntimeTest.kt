package com.connect.messenger
import org.junit.Assert.*
import org.junit.Test
class ConnectCallRuntimeTest {
 @Test fun connectedOpusAndRtpDoNotOverrideMissingFocus(){
  val gate=ConnectCallAudioGate();gate.remote=true;gate.recording=true;gate.playout=true;gate.rtp=true
  val state=ConnectCallState();state.begin("id",false);state.offered();state.identified("server");state.answered();state.transport(true);state.audio(gate.ready)
  assertEquals(ConnectCallState.Phase.CONNECTING,state.phase)
  gate.focus(true);state.audio(gate.ready);assertEquals(ConnectCallState.Phase.ACTIVE,state.phase)
 }
 @Test fun telecomFocusRecoveryRequiresFreshRecordPlayoutAndRtp(){
  val gate=ConnectCallAudioGate();gate.focus(true);gate.remote=true;gate.recording=true;gate.playout=true;gate.rtp=true
  assertTrue(gate.ready);gate.focus(false);assertFalse(gate.ready);gate.focus(true);assertFalse(gate.ready)
  gate.recording=true;gate.playout=true;assertFalse(gate.ready);gate.rtp=true;assertTrue(gate.ready)
  gate.reset();assertFalse(gate.ready);assertFalse(gate.remote)
 }
 @Test fun foregroundRestoreIsIndependentOfReactAndDoesNotRenewCall(){
  val gate=ConnectCallScreenGate()
  assertEquals("NOT_FOREGROUND",gate.request("id",true,false,false,0))
  assertEquals("REQUEST",gate.request("id",true,false,true,50000))
  assertEquals("IN_FLIGHT",gate.request("id",true,false,true,50001))
  assertEquals("ALREADY_VISIBLE",gate.request("id",true,true,true,52000))
  assertEquals("REQUEST",gate.request("id",true,false,true,53000))
  assertEquals("NOT_LIVE",gate.request("id",false,false,true,55000))
 }
 @Test fun nextCallAndExpiredCallCannotSharePresentation(){
  val gate=ConnectCallScreenGate();assertEquals("REQUEST",gate.request("old",true,false,true,0))
  assertEquals("REQUEST",gate.request("new",true,false,true,10))
  assertEquals("NOT_LIVE",gate.request("old",false,false,true,20))
 }
 @Test fun sdpAndWebRtcExceptionsRetainCategoryAndCause(){
  val error=IllegalStateException("private data must never become diagnostics")
  try{ConnectCallErrors.at("webrtc-factory","FACTORY_CREATE"){throw error}}catch(f:ConnectCallFailure){
   assertEquals("webrtc-factory",f.stage);assertEquals("FACTORY_CREATE",f.code);assertSame(error,f.cause)
   assertFalse(ConnectCallErrors.message(f.stage).contains("аудиоустройство"))
  }
  try{ConnectCallErrors.at("sdp","INVALID_OFFER"){throw IllegalArgumentException()}}catch(f:ConnectCallFailure){assertEquals("sdp",f.stage)}
 }
 @Test fun resumeDoesNotAcceptOldCumulativeRtpCounters(){
  val e=ConnectCallMediaEvidence();e.observe("inbound-rtp",20);e.observe("outbound-rtp",30);assertTrue(e.ready)
  e.pause();e.observe("inbound-rtp",20);e.observe("outbound-rtp",30);assertFalse(e.ready)
  e.observe("inbound-rtp",21);assertFalse(e.ready);e.observe("outbound-rtp",31);assertTrue(e.ready)
 }
 @Test fun technicalErrorNeverBecomesDeclineOrMissed(){
  assertEquals("failed",ConnectCallErrors.reason(ConnectCallState.Phase.FAILED))
  assertEquals("decline",ConnectCallErrors.reason(ConnectCallState.Phase.DECLINED))
  assertEquals("hangup",ConnectCallErrors.reason(ConnectCallState.Phase.CANCELLED))
  assertEquals("missed",ConnectCallErrors.reason(ConnectCallState.Phase.NO_ANSWER))
 }
 @Test fun answerStillRequiresServerAndRealAudio(){
  val s=ConnectCallState();s.begin("call",true);s.presenting();s.ringing();s.answering();s.submitAnswer("synthetic-answer")
  s.transport(true);s.audio(true);assertEquals(ConnectCallState.Phase.ANSWERING,s.phase)
  s.answered();s.audio(true);assertEquals(ConnectCallState.Phase.ACTIVE,s.phase)
  assertEquals(64,s.answerFingerprint()!!.length)
  assertTrue(s.end(ConnectCallState.Phase.FAILED));assertNull(s.answerFingerprint());assertFalse(s.end(ConnectCallState.Phase.DECLINED))
  s.begin("next",true);assertFalse(s.ownsAnswer("synthetic-answer"));assertFalse(s.connected)
 }
}
