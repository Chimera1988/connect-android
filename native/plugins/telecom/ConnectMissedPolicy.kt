package com.connect.messenger
// Generated from shared/call-missed-policy.json. Do not edit this predicate.
internal object ConnectMissedPolicy {
    private fun parse(value:String?):Long?=if(value.isNullOrBlank()||!value.matches(Regex("""[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})""")))null else try{java.time.OffsetDateTime.parse(value,java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant().toEpochMilli()}catch(_:Exception){null}
    fun isMissedIncomingCall(id:String,callee:String,status:String,created:String,answered:String?,ended:String?,recipient:String,now:Long,activeCallId:String=""):Boolean = (recipient.isNotEmpty() && callee == recipient && answered.isNullOrEmpty() && (status == "missed" || (status == "ended" && parse(ended) != null) || (status == "ringing" && (parse(created)?.let { now - it > 60000L } == true) && (activeCallId.isEmpty() || id != activeCallId))))
}
