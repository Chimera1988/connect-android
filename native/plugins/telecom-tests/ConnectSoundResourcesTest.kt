package com.connect.messenger
import org.junit.Assert.*
import org.junit.Test
class ConnectSoundResourcesTest {
 @Test fun namedFactoryResourceMigrates(){assertTrue(ConnectSoundResources.isLegacy("android.resource","com.connect.messenger","/raw/connect_soft","com.connect.messenger",0x7f110003))}
 @Test fun numericFactoryResourceMigrates(){assertTrue(ConnectSoundResources.isLegacy("android.resource","com.connect.messenger","/${0x7f110003}","com.connect.messenger",0x7f110003))}
 @Test fun customAndOtherPackagesAreNeverFactory(){
  assertFalse(ConnectSoundResources.isLegacy("content","media","/external/audio/media/17","com.connect.messenger",0x7f110003))
  assertFalse(ConnectSoundResources.isLegacy("android.resource","another.app","/raw/connect_soft","com.connect.messenger",0x7f110003))
 }
 @Test fun otherEmbeddedTonesAndMissingResourceCannotMatch(){
  assertFalse(ConnectSoundResources.isLegacy("android.resource","com.connect.messenger","/raw/connect_bright","com.connect.messenger",0x7f110003))
  assertFalse(ConnectSoundResources.isLegacy("android.resource","com.connect.messenger","/0","com.connect.messenger",0))
 }
}
