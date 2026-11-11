package com.connect.messenger
import org.junit.Assert.*
import org.junit.Test
class ConnectIncomingAlertsTest {
 @Test fun expiredTelecomCallbackDoesNotPresentOrExtendDeadline(){
  val p=ConnectIncomingAlerts();p.begin("call");assertFalse(p.authorize("call",true,0));assertFalse(p.authorize("call",true,-1));assertFalse(p.first("call"));assertFalse(p.claimSignals("call"))
 }
 @Test fun systemSilenceBeforeCallbackCannotBeUndoneByDelayedUi(){
  val p=ConnectIncomingAlerts();p.begin("call");p.silence("call");p.authorize("call",true,20);p.posted("call");assertFalse(p.claimSignals("call"))
  p.close();p.begin("next");p.authorize("next",true,20);p.posted("next");assertTrue(p.claimSignals("next"))
 }
 @Test fun bootstrapAndValidationCannotConsumeFirstCallPresentation(){
  val p=ConnectIncomingAlerts();p.begin("call")
  assertFalse(p.first("call"));assertFalse(p.canPresent("call"));assertFalse(p.claimSignals("call"))
  assertTrue(p.authorize("call",true));assertTrue(p.first("call"))
  p.posted("call");assertFalse(p.first("call"));assertTrue(p.claimSignals("call"))
 }
 @Test fun duplicateTelecomAndFcmCannotStartSecondRing(){
  val p=ConnectIncomingAlerts();p.begin("call");p.authorize("call",true);p.posted("call")
  assertTrue(p.claimSignals("call"));repeat(5){assertTrue(p.authorize("call",true));assertFalse(p.first("call"));assertFalse(p.claimSignals("call"))}
 }
 @Test fun terminalAndWrongCallNeverReceiveUi(){
  val p=ConnectIncomingAlerts();p.begin("call");assertFalse(p.authorize("other",true));assertFalse(p.authorize("call",false));p.close()
  assertFalse(p.authorize("call",true));assertFalse(p.claimSignals("call"))
 }
 @Test fun followingCallHasFreshNotificationAndRejectsOldTelecom(){
  val p=ConnectIncomingAlerts();p.begin("old");p.authorize("old",true);p.posted("old");p.claimSignals("old");p.close()
  p.begin("new");assertFalse(p.authorize("old",true));p.authorize("new",true);assertTrue(p.first("new"));p.posted("new");assertTrue(p.claimSignals("new"))
 }
 @Test fun ringingDoesNotDependOnConversationFocus(){
  for(phase in listOf(ConnectCallState.Phase.INCOMING,ConnectCallState.Phase.PRESENTING))assertTrue(ConnectCallAlertPolicy.keepIncomingOnFocusLoss(phase,true))
  assertFalse(ConnectCallAlertPolicy.keepIncomingOnFocusLoss(ConnectCallState.Phase.ACTIVE,true))
  assertFalse(ConnectCallAlertPolicy.keepIncomingOnFocusLoss(ConnectCallState.Phase.REMOTE_RINGING,false))
 }
 @Test fun sdk35DoesNotTreatObsoleteVibrateWhenRingingAsAnOffSwitch(){
  assertEquals("ALLOWED_SYSTEM_POLICY",ConnectCallAlertPolicy.vibration(35,true,2,true,0,null))
  assertEquals("ALLOWED_SYSTEM_POLICY",ConnectCallAlertPolicy.vibration(35,true,2,true,0,2))
  assertEquals("SYSTEM_RING_INTENSITY_OFF",ConnectCallAlertPolicy.vibration(35,true,2,true,1,0))
 }
 @Test fun sdk29RespectsExplicitLegacySwitchButVibrateModeStillVibrates(){
  assertEquals("SYSTEM_RING_VIBRATION_OFF",ConnectCallAlertPolicy.vibration(29,true,2,true,0,null))
  assertEquals("ALLOWED_SYSTEM_POLICY",ConnectCallAlertPolicy.vibration(29,true,1,true,0,null))
  assertEquals("ALLOWED_SYSTEM_POLICY",ConnectCallAlertPolicy.vibration(29,true,2,true,null,null))
 }
 @Test fun vibrationReasonsRemainDistinct(){
  assertEquals("CONNECT_VIBRATION_OFF",ConnectCallAlertPolicy.vibration(35,false,2,true,null,null))
  assertEquals("NO_VIBRATOR",ConnectCallAlertPolicy.vibration(35,true,2,false,null,null))
  assertEquals("RINGER_SILENT",ConnectCallAlertPolicy.vibration(35,true,0,true,null,null))
 }
 @Test fun preparedOrErrorCallbackCannotRestartEndedOrNextRing(){
  val lease=ConnectRingLease();lease.start();val first=lease.generation;assertTrue(lease.valid(first))
  lease.stop();assertFalse(lease.valid(first));lease.start();assertFalse(lease.valid(first));assertTrue(lease.valid(lease.generation))
 }
 @Test fun fallbackKeepsSameRingLeaseAndStopsOnAnswer(){
  val lease=ConnectRingLease();lease.start();val token=lease.generation
  repeat(2){assertTrue(lease.valid(token))};lease.stop();assertFalse(lease.valid(token));assertFalse(lease.running)
 }
}
