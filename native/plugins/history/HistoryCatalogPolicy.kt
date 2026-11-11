package com.connect.messenger
/** No transient URLs or credentials in the encrypted metadata index. */
internal object HistoryCatalogPolicy{
 fun key(value:String)=value=="inbox"||value.matches(Regex("profile:[a-fA-F0-9-]{36}:(photos|videos|music)"))
 fun property(value:String)=!value.lowercase().contains(Regex("token|authorization|password|secret|signedurl|access_key|refresh_key"))
 fun string(value:String)=value.length<=4000&&!value.contains(Regex("(?i)[?&][^=]*(token|signature)[^=]*=|eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+"))
}
