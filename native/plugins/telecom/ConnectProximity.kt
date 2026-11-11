package com.connect.messenger

internal interface ConnectProximityDriver {
    fun supported():Boolean
    fun held():Boolean
    fun acquire()
    fun release()
    fun observe(enabled:Boolean)
}

/** One service-owned, non-reference-counted lease. No timed black-screen gaps. */
internal class ConnectProximityOwner(private val driver:ConnectProximityDriver) {
    private var observing=false
    fun update(eligible:Boolean){
        if(eligible&&driver.supported()){
            if(!driver.held())driver.acquire()
            if(!observing){driver.observe(true);observing=true}
        }else{
            try{if(driver.held())driver.release()}finally{if(observing){driver.observe(false);observing=false}}
        }
    }
    companion object {
        fun eligible(route:Int,phase:String,connectedOnce:Boolean)=route==1&&connectedOnce&&phase in listOf("ACTIVE","RECONNECTING")
    }
}
