package com.connect.messenger

import java.time.Instant
import java.time.format.DateTimeFormatterBuilder

/** SQL/transaction boundary shared by Android SQLite and real JDBC tests. */
internal interface HistoryDb {
    fun execute(sql:String,args:List<Any?> = emptyList())
    fun query(sql:String,args:List<Any?> = emptyList()):List<Map<String,Any?>>
    fun <T> transaction(block:()->T):T
}
internal interface HistoryCodec {
    fun seal(owner:String,id:String,value:String):ByteArray
    fun open(owner:String,id:String,value:ByteArray):String
}
internal data class HistoryMessage(val id:String,val chat:String,val created:String,val json:String,val deleted:Boolean=false,val revision:String=created,val sender:String="")
internal data class HistorySnapshot(val messages:List<HistoryMessage>,val readAt:String,val savedAt:Long,val epoch:Long,val hasOlder:Boolean,val hasNewer:Boolean)

/** Only confirmed-message cache. Drafts, auth, keys and settings live elsewhere.
 * Tombstones survive ordinary clears; owner epochs invalidate queued stale writes.
 */
internal class HistoryStore(private val db:HistoryDb,private val codec:HistoryCodec,private val now:()->Long={System.currentTimeMillis()}) {
    companion object {
        private val timeFormat=DateTimeFormatterBuilder().appendInstant(6).toFormatter()
        fun time(value:String)=timeFormat.format(Instant.parse(value))
        val schema=listOf(
            "CREATE TABLE IF NOT EXISTS history_owner(owner TEXT PRIMARY KEY,epoch INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE IF NOT EXISTS history_meta(owner TEXT NOT NULL,chat TEXT NOT NULL,read_at TEXT NOT NULL DEFAULT '',read_raw TEXT NOT NULL DEFAULT '',saved_at INTEGER NOT NULL,PRIMARY KEY(owner,chat))",
            "CREATE TABLE IF NOT EXISTS history_messages(owner TEXT NOT NULL,chat TEXT NOT NULL,id TEXT NOT NULL,created_at TEXT NOT NULL,revision_at TEXT NOT NULL,sender_id TEXT NOT NULL,payload BLOB NOT NULL,size INTEGER NOT NULL,used_at INTEGER NOT NULL,PRIMARY KEY(owner,chat,id))",
            "CREATE INDEX IF NOT EXISTS history_page ON history_messages(owner,chat,created_at,id)",
            "CREATE INDEX IF NOT EXISTS history_lru ON history_messages(used_at)",
            "CREATE TABLE IF NOT EXISTS history_retired(owner TEXT NOT NULL,id TEXT NOT NULL,deleted_at INTEGER NOT NULL,PRIMARY KEY(owner,id))"
        )
    }
    init{schema.forEach{db.execute(it)}}
    fun epoch(owner:String):Long{
        db.execute("INSERT OR IGNORE INTO history_owner(owner) VALUES(?)",listOf(owner))
        return (db.query("SELECT epoch FROM history_owner WHERE owner=?",listOf(owner)).first()["epoch"] as Number).toLong()
    }
    fun retired(owner:String,id:String)=db.query("SELECT 1 AS found FROM history_retired WHERE owner=? AND id=?",listOf(owner,id)).isNotEmpty()
    fun write(owner:String,chat:String,messages:List<HistoryMessage>,readAt:String,expectedEpoch:Long):Boolean=db.transaction{
        if(epoch(owner)!=expectedEpoch)return@transaction false
        require(messages.all{it.chat==chat})
        for(m in messages){
            if(m.deleted){drop(owner,m.id);continue}
            if(retired(owner,m.id))continue
            val bytes=codec.seal(owner,m.id,m.json)
            val created=time(m.created);val revision=time(m.revision)
            // Android 10 vendors can ship SQLite 3.22, predating modern UPSERT.
            db.execute("UPDATE history_messages SET created_at=?,revision_at=?,sender_id=?,payload=?,size=?,used_at=? WHERE owner=? AND chat=? AND id=? AND revision_at<=?",listOf(created,revision,m.sender,bytes,bytes.size,now(),owner,chat,m.id,revision))
            db.execute("INSERT OR IGNORE INTO history_messages(owner,chat,id,created_at,revision_at,sender_id,payload,size,used_at) VALUES(?,?,?,?,?,?,?,?,?)",listOf(owner,chat,m.id,created,revision,m.sender,bytes,bytes.size,now()))
        }
        val previous=db.query("SELECT read_at,read_raw FROM history_meta WHERE owner=? AND chat=?",listOf(owner,chat)).firstOrNull()
        val incoming=if(readAt.isEmpty())"" else time(readAt)
        val latest=if(incoming>(previous?.get("read_at") as? String?:""))incoming else previous?.get("read_at") as? String?:""
        val raw=if(latest==incoming&&incoming.isNotEmpty())readAt else previous?.get("read_raw") as? String?:""
        db.execute("UPDATE history_meta SET read_at=?,read_raw=?,saved_at=? WHERE owner=? AND chat=?",listOf(latest,raw,now(),owner,chat))
        db.execute("INSERT OR IGNORE INTO history_meta(owner,chat,read_at,read_raw,saved_at) VALUES(?,?,?,?,?)",listOf(owner,chat,latest,raw,now()))
        true
    }
    fun drop(owner:String,id:String){
        db.execute("INSERT OR IGNORE INTO history_retired(owner,id,deleted_at) VALUES(?,?,?)",listOf(owner,id,now()))
        db.execute("DELETE FROM history_messages WHERE owner=? AND id=?",listOf(owner,id))
    }
    fun clear(owner:String,chat:String?=null):Long=db.transaction{
        epoch(owner)
        db.execute("UPDATE history_owner SET epoch=epoch+1 WHERE owner=?",listOf(owner))
        val args=if(chat==null)listOf(owner)else listOf(owner,chat)
        val filter=if(chat==null)"owner=?" else "owner=? AND chat=?"
        db.execute("DELETE FROM history_messages WHERE $filter",args)
        db.execute("DELETE FROM history_meta WHERE $filter",args)
        epoch(owner)
    }
    fun read(owner:String,chat:String,limit:Int=500,beforeTime:String?=null,beforeId:String?=null,after:Boolean=false):HistorySnapshot=db.transaction{
        val generation=epoch(owner);val count=limit.coerceIn(1,500)
        val meta=db.query("SELECT * FROM history_meta WHERE owner=? AND chat=?",listOf(owner,chat)).firstOrNull()
        fun page(filter:String="",args:List<Any?> = emptyList(),ascending:Boolean=false,size:Int=count)=db.query("SELECT id,created_at,payload,sender_id FROM history_messages WHERE owner=? AND chat=?$filter ORDER BY created_at ${if(ascending)"ASC" else "DESC"},id ${if(ascending)"ASC" else "DESC"} LIMIT ?",listOf(owner,chat)+args+size).let{if(ascending)it else it.reversed()}
        var rows=if(beforeTime!=null&&beforeId!=null){val t=time(beforeTime);val op=if(after)">" else "<";page(" AND (created_at$op? OR (created_at=? AND id$op?))",listOf(t,t,beforeId),after)}else page()
        if(beforeTime==null&&rows.lastOrNull()?.get("sender_id")!=owner){
            val read=meta?.get("read_at") as? String?:""
            val unread=if(read.isEmpty())null else db.query("SELECT created_at,id FROM history_messages WHERE owner=? AND chat=? AND sender_id<>? AND created_at>? ORDER BY created_at,id LIMIT 1",listOf(owner,chat,owner,read)).firstOrNull()
            if(unread!=null){
                val t=unread["created_at"];val id=unread["id"];val prior=page(" AND (created_at<? OR (created_at=? AND id<?))",listOf(t,t,id),false,minOf(30,count/4))
                rows=prior+page(" AND (created_at>? OR (created_at=? AND id>=?))",listOf(t,t,id),true,count-prior.size)
            }
        }
        val messages=rows.mapNotNull{r->
            val id=r["id"] as String
            if(retired(owner,id))null else try{HistoryMessage(id,chat,r["created_at"] as String,codec.open(owner,id,r["payload"] as ByteArray))}catch(_:Exception){
                // Corrupt cached ciphertext is disposable, never an auth failure.
                db.execute("DELETE FROM history_messages WHERE owner=? AND chat=? AND id=?",listOf(owner,chat,id));null
            }
        }
        db.execute("UPDATE history_messages SET used_at=? WHERE owner=? AND chat=?",listOf(now(),owner,chat))
        val first=messages.firstOrNull()
        val hasOlder=first!=null&&db.query("SELECT 1 AS found FROM history_messages WHERE owner=? AND chat=? AND (created_at<? OR (created_at=? AND id<?)) LIMIT 1",listOf(owner,chat,first.created,first.created,first.id)).isNotEmpty()
        val last=messages.lastOrNull()
        val hasNewer=last!=null&&db.query("SELECT 1 AS found FROM history_messages WHERE owner=? AND chat=? AND (created_at>? OR (created_at=? AND id>?)) LIMIT 1",listOf(owner,chat,last.created,last.created,last.id)).isNotEmpty()
        HistorySnapshot(messages,meta?.get("read_raw") as? String?:"",(meta?.get("saved_at") as? Number)?.toLong()?:0L,generation,hasOlder,hasNewer)
    }
    fun stats(owner:String):Map<String,Long>{
        val row=db.query("SELECT count(*) AS messages,count(DISTINCT chat) AS chats,coalesce(sum(size),0) AS bytes FROM history_messages WHERE owner=?",listOf(owner)).first()
        return mapOf("messages" to (row["messages"] as Number).toLong(),"chats" to (row["chats"] as Number).toLong(),"bytes" to (row["bytes"] as Number).toLong(),"epoch" to epoch(owner))
    }
    fun trim(maxBytes:Long){
        require(maxBytes>=1024*1024)
        db.execute("DELETE FROM history_messages WHERE used_at<?",listOf(now()-30L*86400000))
        var bytes=(db.query("SELECT coalesce(sum(size),0) AS bytes FROM history_messages").first()["bytes"] as Number).toLong()
        if(bytes<=maxBytes)return
        for(row in db.query("SELECT owner,chat,id,size FROM history_messages ORDER BY used_at,id")){
            if(bytes<=maxBytes)break
            db.execute("DELETE FROM history_messages WHERE owner=? AND chat=? AND id=?",listOf(row["owner"],row["chat"],row["id"]));bytes-=(row["size"] as Number).toLong()
        }
    }
}
