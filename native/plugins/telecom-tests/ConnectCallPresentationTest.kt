package com.connect.messenger
import org.junit.Assert.*
import org.junit.Test
class ConnectCallPresentationTest {
 @Test fun preparingActivityReceivesServerIdPromotionAndEnd(){
   val operation="operation-1";val server="server-1"
   assertFalse(operation==server)
   assertTrue(ConnectCallPresentation.accepts(operation,operation,server,operation))
   assertTrue(ConnectCallPresentation.accepts(server,operation,server,operation))
 }
 @Test fun latePriorCallCannotRepaintOrDismissTheNextCall(){
   assertFalse(ConnectCallPresentation.accepts("next-server","next-operation","old-server","old-operation"))
   assertFalse(ConnectCallPresentation.accepts("","","server",""))
   assertFalse(ConnectCallPresentation.accepts("next-server","next-operation","old-server",""))
 }
 @Test fun incomingCallHasNoOperationAlias(){
   assertTrue(ConnectCallPresentation.accepts("incoming","incoming","incoming","incoming"))
   assertFalse(ConnectCallPresentation.accepts("incoming","incoming","other","other"))
 }
 @Test fun activeRequiresRealPacketsInBothDirections(){
   val e=ConnectCallMediaEvidence()
   e.observe("inbound-rtp",0);e.observe("outbound-rtp",0);assertFalse(e.ready)
   e.observe("remote-inbound-rtp",5);assertFalse(e.ready)
   e.observe("inbound-rtp",5);assertFalse(e.ready)
   e.observe("outbound-rtp",2);assertTrue(e.ready)
   e.reset();assertFalse(e.ready)
 }
 @Test fun durableHintsCannotCrossAccountsOrExtendAnExpiredCall(){
   assertTrue(ConnectCallHintPolicy.accepts(60000,"owner","owner",50000))
   assertFalse(ConnectCallHintPolicy.accepts(60000,"owner","other",50000))
   assertTrue(ConnectCallHintPolicy.accepts(60000,"","owner",50000))
   assertFalse(ConnectCallHintPolicy.accepts(60000,"","owner",60000))
 }
 @Test fun answeredAndConnectedStillWaitForAudioPackets(){
   val state=ConnectCallState();state.begin("call",true);state.answered();state.transport(true)
   val e=ConnectCallMediaEvidence();e.observe("outbound-rtp",7);state.audio(e.ready)
   assertEquals(ConnectCallState.Phase.CONNECTING,state.phase)
   e.observe("inbound-rtp",3);state.audio(e.ready);assertEquals(ConnectCallState.Phase.ACTIVE,state.phase)
 }
}
