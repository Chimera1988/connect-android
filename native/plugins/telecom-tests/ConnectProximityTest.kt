package com.connect.messenger
import org.junit.Assert.*
import org.junit.Test
class ConnectProximityTest {
 private class Driver(val available:Boolean=true):ConnectProximityDriver{
  var acquired=0;var released=0;var observed=false;var live=false
  override fun supported()=available
  override fun held()=live
  override fun acquire(){check(!live);live=true;acquired++}
  override fun release(){check(live);live=false;released++}
  override fun observe(enabled:Boolean){observed=enabled}
 }
 @Test fun longCallDoesNotReacquireOrExpireEveryTenMinutes(){val d=Driver();val p=ConnectProximityOwner(d);repeat(4000){p.update(true)};assertEquals(1,d.acquired);assertTrue(d.live);p.update(false);p.update(false);assertEquals(1,d.released);assertFalse(d.observed)}
 @Test fun routeSwitchAndFollowingCallAreBalanced(){val d=Driver();val p=ConnectProximityOwner(d);p.update(true);p.update(false);p.update(true);p.update(false);assertEquals(2,d.acquired);assertEquals(2,d.released)}
 @Test fun unsupportedDeviceDoesNotAttemptAcquire(){val d=Driver(false);val p=ConnectProximityOwner(d);p.update(true);p.update(false);assertEquals(0,d.acquired);assertFalse(d.observed)}
 @Test fun onlyEstablishedEarpieceOrReconnectIsEligible(){assertTrue(ConnectProximityOwner.eligible(1,"ACTIVE",true));assertTrue(ConnectProximityOwner.eligible(1,"RECONNECTING",true));for(route in listOf(2,4,8))assertFalse(ConnectProximityOwner.eligible(route,"ACTIVE",true));for(phase in listOf("INCOMING","CONNECTING","ENDED","FAILED"))assertFalse(ConnectProximityOwner.eligible(1,phase,true));assertFalse(ConnectProximityOwner.eligible(1,"RECONNECTING",false))}
}
