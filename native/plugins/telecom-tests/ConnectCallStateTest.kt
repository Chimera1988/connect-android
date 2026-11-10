package com.connect.messenger

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class ConnectCallStateTest {
    @org.junit.Test fun acceptedAnswerIsImmutableWhileLocalDescriptionGathersIce() {
        val state=ConnectCallState();state.begin("call",true);state.answered()
        val submitted="v=0\r\na=ice-ufrag:same\r\na=fingerprint:sha-256 SAME\r\n"
        state.submitAnswer(submitted)
        val localAfterGathering=submitted+"a=candidate:1 1 UDP 1 127.0.0.1 1234 typ host\r\n"
        org.junit.Assert.assertTrue(state.ownsAnswer(submitted))
        org.junit.Assert.assertFalse(state.ownsAnswer(localAfterGathering))
        state.end(ConnectCallState.Phase.ENDED);state.begin("next-call",true)
        org.junit.Assert.assertFalse(state.ownsAnswer(submitted))
    }
    @Test fun serverAnswerAndButtonDoNotActivateAnUnconnectedCall() {
        val state = ConnectCallState(); state.begin("first", true); state.answered()
        assertEquals(ConnectCallState.Phase.CONNECTING, state.phase)
        state.audio(true)
        assertEquals(ConnectCallState.Phase.CONNECTING, state.phase)
        state.transport(true)
        assertEquals(ConnectCallState.Phase.ACTIVE, state.phase)
    }
    @Test fun transportWithoutReadyAudioIsNotAConversation() {
        val state = ConnectCallState(); state.begin("first", false); state.identified("server-id"); state.answered(); state.transport(true)
        assertEquals(ConnectCallState.Phase.CONNECTING, state.phase)
        state.audio(true); assertEquals(ConnectCallState.Phase.ACTIVE, state.phase)
    }
    @Test fun reconnectKeepsTheSessionAndDoesNotBecomeANewIncomingCall() {
        val state = ConnectCallState(); val generation = state.begin("first", true)
        state.answered(); state.audio(true); state.transport(true)
        state.transport(false); assertEquals(ConnectCallState.Phase.RECONNECTING, state.phase)
        state.transport(true); assertEquals(ConnectCallState.Phase.ACTIVE, state.phase)
        assertTrue(state.connectedOnce); assertTrue(state.valid(generation)); assertEquals("first", state.id)
    }
    @Test fun lossOfAudioReadinessAlsoRequiresRecovery() {
        val state = ConnectCallState(); state.begin("first", true); state.answered(); state.audio(true); state.transport(true)
        state.audio(false); assertEquals(ConnectCallState.Phase.RECONNECTING,state.phase)
        state.transport(true); assertEquals(ConnectCallState.Phase.RECONNECTING,state.phase)
        state.audio(true); assertEquals(ConnectCallState.Phase.ACTIVE,state.phase)
    }
    @Test fun allTerminalPathsAreIdempotentAndInvalidateLatePeerCallbacks() {
        for (result in listOf(ConnectCallState.Phase.ENDED, ConnectCallState.Phase.DECLINED, ConnectCallState.Phase.MISSED, ConnectCallState.Phase.BUSY, ConnectCallState.Phase.FAILED, ConnectCallState.Phase.CANCELLED)) {
            val state = ConnectCallState(); val old = state.begin("first", true); state.answered()
            assertTrue(state.end(result)); assertFalse(state.end(result)); assertFalse(state.valid(old))
            state.transport(true); state.audio(true); assertEquals(result, state.phase)
            val next = state.begin("next", false); assertTrue(state.valid(next)); assertFalse(state.valid(old)); assertEquals("next", state.id)
        }
    }
    @Test fun anotherSimultaneousCallCannotReplaceTheActiveOne() {
        val state = ConnectCallState(); state.begin("first", true)
        assertThrows(IllegalStateException::class.java) { state.begin("second", true) }
        assertEquals("first",state.id)
    }
    @Test fun incomingRequiresOwnerRingingAndOriginalDeadline() {
        val now = 1_000_000L
        assertTrue(ConnectCallState.validIncoming("a","a","ringing",now-1000,now))
        assertFalse(ConnectCallState.validIncoming("a","b","ringing",now-1000,now))
        assertFalse(ConnectCallState.validIncoming("a","a","active",now-1000,now))
        assertFalse(ConnectCallState.validIncoming("a","a","ended",now-1000,now))
        assertFalse(ConnectCallState.validIncoming("a","a","ringing",now-60000,now))
        assertFalse(ConnectCallState.validIncoming("a","a","ringing",now+11000,now))
    }
    @Test fun repeatedCallsDoNotAcceptPriorGenerationCallbacks() {
        val state = ConnectCallState()
        for(i in 0 until 5000){val token=state.begin("call-$i",false);state.identified("server-$i");state.answered();state.end(ConnectCallState.Phase.ENDED);assertFalse(state.valid(token));state.transport(true);assertTrue(state.terminal())}
    }
    @Test fun accountSwitchDuringIncomingValidationCannotPresentTheOldCall(){
        assertFalse(ConnectCallState.validIncoming("a","a","ringing",9000,10000,3,4))
        assertTrue(ConnectCallState.validIncoming("a","a","ringing",9000,10000,4,4))
    }
    @Test fun unreadMessageThenEndedCallThenDelayedDuplicateDoesNotRecreateAnAlert(){
        val state=ConnectCallState()
        assertTrue(ConnectCallState.allowStart("incoming",false,false))
        state.begin("first",true);state.end(ConnectCallState.Phase.ENDED)
        assertFalse(ConnectCallState.allowStart("incoming",false,true))
        assertFalse(ConnectCallState.allowStart("remote-end",false,true))
        assertFalse(ConnectCallState.allowStart("answer",false,true))
        assertTrue(ConnectCallState.allowStart("incoming",false,false))
        state.begin("next",true);assertEquals(ConnectCallState.Phase.INCOMING,state.phase)
    }
    private fun energy(samples: ShortArray, from: Double, until: Double): Double {
        val range=(from*16000).toInt() until (until*16000).toInt()
        return range.sumOf { samples[it].toDouble().pow(2) }/range.count()
    }
    private fun spectrum(samples: ShortArray,hz: Double,from: Double,until: Double): Double {
        var real=0.0;var imag=0.0
        for(i in (from*16000).toInt() until (until*16000).toInt()){val a=2*PI*hz*i/16000;real+=samples[i]*cos(a);imag+=samples[i]*sin(a)}
        return real*real+imag*imag
    }
    @Test fun outgoingHasExactlyThePwaPaired440And480HzPulsesAndSilence() {
        val samples=ConnectCallPcm.samples(false);assertEquals(57600,samples.size)
        assertTrue(energy(samples,.05,.40)>10000);assertTrue(energy(samples,.69,1.04)>10000)
        assertEquals(0.0,energy(samples,.46,.63),0.0);assertEquals(0.0,energy(samples,1.10,3.60),0.0)
        for(hz in listOf(440.0,480.0))assertTrue(spectrum(samples,hz,.04,.40)>spectrum(samples,659.25,.04,.40)*100)
    }
    @Test fun connectionConfirmationContains740Then988AndNeverLoops() {
        val samples=ConnectCallPcm.samples(true);assertEquals(4960,samples.size)
        assertTrue(spectrum(samples,740.0,.01,.11)>spectrum(samples,988.0,.01,.11)*100)
        assertTrue(spectrum(samples,988.0,.13,.30)>spectrum(samples,740.0,.13,.30)*100)
    }
}
