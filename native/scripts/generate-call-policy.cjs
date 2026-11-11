const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),spec=require('../shared/call-missed-policy.json');
function expression(e){const [op,...a]=e;switch(op){case'all':return '('+a.map(expression).join(' && ')+')';case'any':return '('+a.map(expression).join(' || ')+')';case'owner':return 'recipient.isNotEmpty() && callee == recipient';case'unanswered':return 'answered.isNullOrEmpty()';case'status':return 'status == '+JSON.stringify(a[0]);case'valid-date':return 'parse(ended) != null';case'older-than':return '(parse(created)?.let { now - it > '+a[1]+'L } == true)';case'not-active':return '(activeCallId.isEmpty() || id != activeCallId)';default:throw Error('Unknown predicate '+op)}}
const text=`package com.connect.messenger
// Generated from shared/call-missed-policy.json. Do not edit this predicate.
internal object ConnectMissedPolicy {
    private fun parse(value:String?):Long?=if(value.isNullOrBlank()||!value.matches(Regex("""[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})""")))null else try{java.time.OffsetDateTime.parse(value,java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant().toEpochMilli()}catch(_:Exception){null}
    fun isMissedIncomingCall(id:String,callee:String,status:String,created:String,answered:String?,ended:String?,recipient:String,now:Long,activeCallId:String=""):Boolean = ${expression(spec.predicate)}
}
`;
const target=path.join(root,'plugins/telecom/ConnectMissedPolicy.kt');
if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text)throw Error('Regenerate the shared call predicate');}else fs.writeFileSync(target,text);
