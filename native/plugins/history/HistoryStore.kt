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
        fun time(value:String)=timeFormat.format(java.time.OffsetDateTime.parse(value,java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant())
        val schema=listOf(
            "CREATE TABLE IF NOT EXISTS history_owner(owner TEXT PRIMARY KEY,epoch INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE IF NOT EXISTS history_meta(owner TEXT NOT NULL,chat TEXT NOT NULL,read_at TEXT NOT NULL DEFAULT '',read_raw TEXT NOT NULL DEFAULT '',saved_at INTEGER NOT NULL,PRIMARY KEY(owner,chat))",
            "CREATE TABLE IF NOT EXISTS history_messages(owner TEXT NOT NULL,chat TEXT NOT NULL,id TEXT NOT NULL,created_at TEXT NOT NULL,revision_at TEXT NOT NULL,sender_id TEXT NOT NULL,payload BLOB NOT NULL,size INTEGER NOT NULL,used_at INTEGER NOT NULL,PRIMARY KEY(owner,chat,id))",
            "CREATE INDEX IF NOT EXISTS history_page ON history_messages(owner,chat,created_at,id)",
            "CREATE INDEX IF NOT EXISTS history_lru ON history_messages(used_at)",
            "CREATE TABLE IF NOT EXISTS history_catalog(owner TEXT NOT NULL,catalog TEXT NOT NULL,payload BLOB NOT NULL,size INTEGER NOT NULL,used_at INTEGER NOT NULL,PRIMARY KEY(owner,catalog))",
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
        catalogDrop(owner,"inbox")
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
    fun catalogRead(owner:String,key:String):String?=db.transaction{
        val row=db.query("SELECT payload FROM history_catalog WHERE owner=? AND catalog=?",listOf(owner,key)).firstOrNull()?:return@transaction null
        try{val value=codec.open(owner,"catalog:$key",row["payload"] as ByteArray);db.execute("UPDATE history_catalog SET used_at=? WHERE owner=? AND catalog=?",listOf(now(),owner,key));value}catch(_:Exception){catalogDrop(owner,key);null}
    }
    fun catalogWrite(owner:String,key:String,value:String,expectedEpoch:Long):Boolean=db.transaction{
        if(epoch(owner)!=expectedEpoch)return@transaction false
        require(value.toByteArray().size<=90000)
        val bytes=codec.seal(owner,"catalog:$key",value)
        db.execute("UPDATE history_catalog SET payload=?,size=?,used_at=? WHERE owner=? AND catalog=?",listOf(bytes,bytes.size,now(),owner,key))
        db.execute("INSERT OR IGNORE INTO history_catalog(owner,catalog,payload,size,used_at) VALUES(?,?,?,?,?)",listOf(owner,key,bytes,bytes.size,now()));true
    }
    fun catalogDrop(owner:String,key:String){db.execute("DELETE FROM history_catalog WHERE owner=? AND catalog=?",listOf(owner,key))}
    fun stats(owner:String):Map<String,Long>{
        val row=db.query("SELECT count(*) AS messages,count(DISTINCT chat) AS chats,coalesce(sum(size),0) AS bytes FROM history_messages WHERE owner=?",listOf(owner)).first()
        return mapOf("messages" to (row["messages"] as Number).toLong(),"chats" to (row["chats"] as Number).toLong(),"bytes" to (row["bytes"] as Number).toLong()+(db.query("SELECT coalesce(sum(size),0) AS bytes FROM history_catalog WHERE owner=?",listOf(owner)).first()["bytes"] as Number).toLong(),"epoch" to epoch(owner))
    }
    fun trim(maxBytes:Long){
        require(maxBytes>=1024*1024)
        db.execute("DELETE FROM history_messages WHERE used_at<?",listOf(now()-30L*86400000))
        db.execute("DELETE FROM history_catalog WHERE used_at<?",listOf(now()-30L*86400000))
        var catalogBytes=(db.query("SELECT coalesce(sum(size),0) AS bytes FROM history_catalog").first()["bytes"] as Number).toLong()
        for(row in db.query("SELECT owner,catalog,size FROM history_catalog ORDER BY used_at")){
            if(catalogBytes<=maxBytes/10)break
            catalogDrop(row["owner"] as String,row["catalog"] as String);catalogBytes-=(row["size"] as Number).toLong()
        }
        var bytes=(db.query("SELECT coalesce(sum(size),0) AS bytes FROM history_messages").first()["bytes"] as Number).toLong()
        val messageLimit=maxOf(0,maxBytes-catalogBytes)
        if(bytes<=messageLimit)return
        for(row in db.query("SELECT owner,chat,id,size FROM history_messages ORDER BY used_at,id")){
            if(bytes<=messageLimit)break
            db.execute("DELETE FROM history_messages WHERE owner=? AND chat=? AND id=?",listOf(row["owner"],row["chat"],row["id"]));bytes-=(row["size"] as Number).toLong()
        }
    }
}

// CONNECT_MEDIA_RESPONSE_CACHE_V1 — shared file/Range engine; no auth/history schema change.
internal data class ConnectMediaReply(val status:Int,val type:String,val headers:Map<String,String>,val body:java.io.InputStream)
internal class ConnectMediaStore(private val root:java.io.File,private val origin:String,private val sessionEpoch:()->Int){
    private data class Scope(val user:String,val nonce:String,val authEpoch:Int,val serial:Long,var limit:Long)
    private data class Meta(val id:String,var type:String,var tag:String,var total:Long,var complete:Boolean,var used:Long,var version:String,val ranges:MutableList<LongRange>)
    private data class Lease(val scope:Scope,val id:String,val fileEpoch:Long,val categories:Map<String,Long>)
    private val gate=java.lang.Object()
    @Volatile private var scope:Scope?=null
    private var serial=0L
    private val generations=mutableMapOf<String,Long>()
    private val categoryEpochs=mutableMapOf<String,Long>()
    private val versions=mutableMapOf<String,String>()
    private val flights=mutableMapOf<String,Int>()
    private val maxFile=2L*1024*1024*1024
    private fun hash(value:String)=java.security.MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
    private fun folder(s:Scope)=java.io.File(root,hash(s.user)).apply{mkdirs()}
    private fun path(s:Scope,id:String,suffix:String)=java.io.File(folder(s),hash(id)+suffix)
    private fun key(s:Scope,id:String)=s.user+":"+id
    private fun category(id:String,type:String="")=when{ id.startsWith("connect-avatars/")->"system";type.startsWith("image/")->"photos";type.startsWith("video/")||id.matches(Regex(".*[.](mp4|webm|mov)$",RegexOption.IGNORE_CASE))->"videos";type.startsWith("audio/")||id.matches(Regex(".*[.](mp3|m4a|aac|ogg|opus|wav|flac)$",RegexOption.IGNORE_CASE))->"audio";id.matches(Regex(".*[.](png|jpe?g|webp|gif|svg)$",RegexOption.IGNORE_CASE))||id.startsWith("connect-stickers/")->"photos";else->"other"}
    private fun strong(tag:String)=tag.startsWith('"')&&tag.endsWith('"')&&!tag.contains('\r')&&!tag.contains('\n')&&tag.length<=512
    private fun validId(id:String)=id.length in 3..4096&&id.substringBefore('/') in setOf("connect-attachments","connect-avatars","connect-stickers","connect-profile-media")&&id.split('/').none{it.isEmpty()||it=="."||it==".."}&&!id.any{it<' '||it=='\\'||it=='?'||it=='#'}
    fun bind(user:String,nonce:String,limit:Long)=synchronized(gate){
        require(user.length in 1..128&&nonce.matches(Regex("[A-Za-z0-9_-]{32,128}"))&&limit in 0..maxFile)
        val old=scope
        if(old?.user==user&&old.nonce==nonce&&old.authEpoch==sessionEpoch())old.limit=limit
        else scope=Scope(user,nonce,sessionEpoch(),++serial,limit)
        gate.notifyAll()
    }
    fun unbind(nonce:String)=synchronized(gate){if(scope?.nonce==nonce){scope=null;serial++;gate.notifyAll()}}
    fun authorize(user:String,nonce:String)=synchronized(gate){val s=current();require(s.user==user&&s.nonce==nonce)}
    fun cachedFile(user:String,identity:String):String?=synchronized(gate){val s=current();require(s.user==user&&validId(identity));val m=read(s,identity);if(m?.complete==true&&!path(s,identity,".retired").exists())path(s,identity,".bytes").toURI().toString()else null}
    private fun current():Scope=scope?.takeIf{it.authEpoch==sessionEpoch()}?:throw java.io.IOException("Media account changed")
    private fun lease(s:Scope,id:String)=Lease(s,id,generations[key(s,id)]?:0,listOf("system","photos","videos","audio","other").associateWith{categoryEpochs[s.user+":"+it]?:0})
    private fun authorized(l:Lease)=scope===l.scope&&l.scope.authEpoch==sessionEpoch()
    private fun valid(l:Lease,type:String="")=authorized(l)&&(generations[key(l.scope,l.id)]?:0)==l.fileEpoch&&(categoryEpochs[l.scope.user+":"+category(l.id,type)]?:0)==l.categories[category(l.id,type)]&&!path(l.scope,l.id,".retired").exists()
    private fun merged(parts:List<LongRange>):MutableList<LongRange>{val out=mutableListOf<LongRange>();for(p in parts.sortedBy{it.first}){if(out.isNotEmpty()&&p.first<=out.last().last+1){val old=out.removeAt(out.lastIndex);out.add(old.first..maxOf(old.last,p.last))}else out.add(p)};return out}
    private fun read(s:Scope,id:String):Meta?{
        val file=path(s,id,".meta");if(!file.isFile)return null
        return try{val p=java.util.Properties();file.inputStream().use{p.load(it)};val total=p.getProperty("total","-1").toLong();val spans=p.getProperty("ranges","").split(',').filter{it.isNotEmpty()}.map{val a=it.split(':');a[0].toLong()..a[1].toLong()};require(total in -1..maxFile&&spans.all{it.first>=0&&it.last>=it.first&&it.last<maxFile});val data=path(s,id,".bytes");if(!data.isFile||spans.any{it.last>=data.length()})return null;Meta(id,p.getProperty("type","application/octet-stream"),p.getProperty("tag",""),total,p.getProperty("complete")=="true",p.getProperty("used","0").toLong(),p.getProperty("version",""),merged(spans))}catch(_:Exception){null}
    }
    private fun save(s:Scope,m:Meta){
        val p=java.util.Properties();p.setProperty("id",m.id);p.setProperty("type",m.type);p.setProperty("tag",m.tag);p.setProperty("total",m.total.toString());p.setProperty("complete",m.complete.toString());p.setProperty("used",m.used.toString());p.setProperty("version",m.version);p.setProperty("ranges",m.ranges.joinToString(","){"${it.first}:${it.last}"})
        val file=path(s,m.id,".meta");val temp=java.io.File(file.path+".tmp");java.io.FileOutputStream(temp).use{p.store(it,null);it.fd.sync()};check(temp.renameTo(file)){"Cannot persist media index"}
    }
    private fun remove(s:Scope,id:String,retire:Boolean=false){
        generations[key(s,id)]=(generations[key(s,id)]?:0)+1
        listOf(".bytes",".meta",".meta.tmp").forEach{path(s,id,it).delete()}
        if(retire)path(s,id,".retired").writeText("retired")
    }
    private fun all(s:Scope)=folder(s).listFiles().orEmpty().filter{it.name.endsWith(".meta")}.mapNotNull{file->try{val p=java.util.Properties();file.inputStream().use{p.load(it)};p.getProperty("id")?.takeIf(::validId)?.let{read(s,it)}}catch(_:Exception){null}}
    private fun bytes(m:Meta)=m.ranges.sumOf{it.last-it.first+1}
    private fun trim(s:Scope,keep:String){
        val rows=all(s).sortedBy{it.used};var temporary=rows.filter{category(it.id,it.type)!="system"}.sumOf(::bytes);var system=rows.filter{category(it.id,it.type)=="system"}.sumOf(::bytes)
        for(m in rows){if(m.id==keep||m.id.startsWith("connect-stickers/"))continue;val protected=category(m.id,m.type)=="system";if(if(protected)system<=64L*1024*1024 else temporary<=s.limit)continue;remove(s,m.id);if(protected)system-=bytes(m) else temporary-=bytes(m)}
    }
    fun clear(category:String,identity:String?=null,retire:Boolean=false)=synchronized(gate){
        val s=current();require(category in setOf("temporary","system","photos","videos","audio","other"));if(identity!=null){require(validId(identity));remove(s,identity,retire)}else{
            val affected=if(category=="temporary")listOf("photos","videos","audio","other")else listOf(category)
            for(kind in affected)categoryEpochs[s.user+":"+kind]=(categoryEpochs[s.user+":"+kind]?:0)+1
            all(s).filter{category(it.id,it.type) in affected}.forEach{remove(s,it.id)}
        };gate.notifyAll()
    }
    fun revive(identity:String)=synchronized(gate){val s=current();require(validId(identity));path(s,identity,".retired").delete();Unit}
    fun stats():Map<String,Long> =synchronized(gate){val s=current();val rows=all(s);listOf("system","photos","videos","audio","other").associateWith{kind->rows.filter{category(it.id,it.type)==kind}.sumOf(::bytes)}}
    fun lookup(identity:String,version:String=""):Map<String,Any>?=synchronized(gate){
        val s=current();require(validId(identity)&&version.length<=512)
        if(version.isNotEmpty()){
            val old=versions[key(s,identity)]?:read(s,identity)?.version.orEmpty();versions[key(s,identity)]=version
            if(old.isNotEmpty()&&old!=version)remove(s,identity)
        }
        if(path(s,identity,".retired").exists())return null
        val m=read(s,identity)?:return null;if(!m.complete)return null
        m.used=System.currentTimeMillis();if(version.isNotEmpty())m.version=version;save(s,m)
        val encoded=identity.split('/').joinToString("/"){java.net.URLEncoder.encode(it,"UTF-8").replace("+","%20")}
        mapOf("complete" to true,"url" to "$origin/supabase/storage/v1/object/authenticated/$encoded?__cm=${s.nonce}&__cm_local=1","size" to m.total,"type" to m.type)
    }
    private fun error(status:Int,total:Long?=null)=ConnectMediaReply(status,"text/plain",buildMap{put("Cache-Control","no-store");if(total!=null)put("Content-Range","bytes */$total")},java.io.ByteArrayInputStream(byteArrayOf()))
    private fun bounds(range:String?,total:Long):LongRange?{
        if(range==null||range.contains(','))return 0L..(total-1)
        val match=Regex("bytes=(\\d*)-(\\d*)").matchEntire(range)?:return null
        val a=match.groupValues[1];val b=match.groupValues[2];if(a.isEmpty()&&b.isEmpty())return null
        return try{val start=if(a.isEmpty())maxOf(0,total-b.toLong())else a.toLong();val end=if(a.isEmpty()||b.isEmpty())total-1 else minOf(total-1,b.toLong());if(start<0||start>=total||end<start)null else start..end}catch(_:Exception){null}
    }
    private fun response(m:Meta,range:String?,body:java.io.InputStream):ConnectMediaReply{
        val span=bounds(range,m.total)?:return error(416,m.total);val partial=range!=null&&!range.contains(',');val headers=mutableMapOf("Content-Type" to m.type,"Accept-Ranges" to "bytes","Content-Length" to (span.last-span.first+1).toString(),"Cache-Control" to "private, no-store")
        if(m.tag.isNotEmpty())headers["ETag"]=m.tag;if(partial)headers["Content-Range"]="bytes ${span.first}-${span.last}/${m.total}"
        return ConnectMediaReply(if(partial)206 else 200,m.type,headers,body)
    }
    private fun covers(m:Meta,span:LongRange)=m.ranges.any{it.first<=span.first&&it.last>=span.last}
    private fun local(l:Lease,m:Meta,range:String?):ConnectMediaReply{
        val span=bounds(range,m.total)?:return error(416,m.total);val file=java.io.RandomAccessFile(path(l.scope,l.id,".bytes"),"r");file.seek(span.first);var left=span.last-span.first+1
        val body=object:java.io.InputStream(){override fun read():Int{val one=ByteArray(1);return if(read(one,0,1)<0)-1 else one[0].toInt() and 255};override fun read(b:ByteArray,off:Int,len:Int):Int{synchronized(gate){if(!authorized(l))throw java.io.IOException("Media account changed");if(left<=0)return -1;val n=file.read(b,off,minOf(left,len.toLong()).toInt());if(n<0)throw java.io.IOException("Incomplete cached media");left-=n;return n}};override fun close(){file.close()}}
        return response(m,range,body)
    }
    private fun clean(uri:java.net.URI):String{val query=uri.rawQuery.orEmpty().split('&').filter{it.substringBefore('=') !in setOf("__cm","__cm_local")}.filter{it.isNotEmpty()}.joinToString("&");return uri.scheme+"://"+uri.rawAuthority+uri.rawPath+(if(query.isEmpty())"" else "?$query")}
    fun open(url:String,headers:Map<String,String> = emptyMap()):ConnectMediaReply?{
        val uri=try{java.net.URI(url)}catch(_:Exception){return null};val base=java.net.URI(origin)
        if(uri.scheme!=base.scheme||uri.host!=base.host||uri.port!=base.port||uri.rawUserInfo!=null)return null
        val match=Regex(".*/storage/v1/object/(?:sign|public|authenticated)/(.+)").matchEntire(uri.path)?:return null
        val id=match.groupValues[1];if(!validId(id))return null
        val query=uri.rawQuery.orEmpty().split('&').associate{it.substringBefore('=') to it.substringAfter('=',"")};val cap=query["__cm"]?:return null
        var range=headers.entries.find{it.key.equals("Range",true)}?.value
        val localOnly=query["__cm_local"]=="1"
        val s:Scope;var l:Lease;var meta:Meta?;var reserved=false
        synchronized(gate){
            s=try{current()}catch(_:Exception){return error(403)};if(cap!=s.nonce)return error(403);l=lease(s,id);if(!valid(l))return error(410)
            meta=read(s,id)
            val condition=headers.entries.find{it.key.equals("If-Range",true)}?.value
            if(condition!=null&&condition!=meta?.tag)range=null
            if(meta?.complete==true){meta!!.used=System.currentTimeMillis();save(s,meta!!);return local(l,meta!!,range)}
            if(localOnly)return error(504)
            if(meta!=null&&strong(meta!!.tag)){
                val span=bounds(range,meta!!.total)?:return error(416,meta!!.total)
                if(covers(meta!!,span))return local(l,meta!!,range)
            }
            if(category(id)!in setOf("audio","videos")&&(flights[key(s,id)]?:0)>0){
                val until=System.currentTimeMillis()+20000
                while((flights[key(s,id)]?:0)>0&&valid(l)&&System.currentTimeMillis()<until)gate.wait(100)
                if(!valid(l))return error(403);meta=read(s,id);if(meta?.complete==true)return local(l,meta!!,range)
                if((flights[key(s,id)]?:0)>0)return error(503)
            }
            if(category(id)!in setOf("audio","videos")){flights[key(s,id)]=(flights[key(s,id)]?:0)+1;reserved=true}
        }
        if(meta!=null&&strong(meta!!.tag)&&meta!!.total>0){
            val span=bounds(range,meta!!.total)?:return error(416,meta!!.total)
            val spans=meta!!.ranges.toList();var first=span.first
            while(first<=span.last){val covered=spans.find{first in it}?:break;first=covered.last+1}
            val end=minOf(span.last,spans.filter{it.first>first}.minOfOrNull{it.first-1}?:span.last)
            val initial=network(clean(uri),headers,l,"bytes=$first-$end",meta!!.tag,reserved)
            if(initial.status==206&&initial.headers["ETag"]==meta!!.tag){
                val actualRange=initial.headers["Content-Range"].orEmpty();if(actualRange!="bytes $first-$end/${meta!!.total}"){initial.body.close();return error(502)}
                var offset=span.first;var source:java.io.InputStream?=null;var sourceEnd=-1L;var initialUsed=false
                val body=object:java.io.InputStream(){
                    override fun read():Int{val a=ByteArray(1);return if(read(a,0,1)<0)-1 else a[0].toInt() and 255}
                    override fun read(b:ByteArray,off:Int,len:Int):Int{
                        if(offset>span.last)return -1
                        synchronized(gate){if(!valid(l,meta!!.type))throw java.io.IOException("Media lease changed")}
                        if(source==null||offset>sourceEnd){source?.close();val latest=synchronized(gate){read(s,id)?:throw java.io.IOException("Media cache cleared")};val cached=latest.ranges.find{offset in it}
                            if(cached!=null){sourceEnd=minOf(cached.last,span.last);source=local(l,latest,"bytes=$offset-$sourceEnd").body}
                            else{sourceEnd=minOf(span.last,latest.ranges.filter{it.first>offset}.minOfOrNull{it.first-1}?:span.last);val reply=if(!initialUsed&&offset==first){initialUsed=true;initial}else network(clean(uri),headers,l,"bytes=$offset-$sourceEnd",meta!!.tag);if(reply.status!=206||reply.headers["ETag"]!=meta!!.tag){reply.body.close();synchronized(gate){remove(s,id)};throw java.io.IOException("Media changed during playback")};source=reply.body}}
                        val n=source!!.read(b,off,minOf(len.toLong(),sourceEnd-offset+1).toInt());if(n<0)throw java.io.IOException("Truncated media range");offset+=n;return n
                    }
                    override fun close(){source?.close();if(!initialUsed)initial.body.close()}
                }
                return response(meta!!,range,body)
            }
            // If-Range failed: forward the complete new representation, never splice versions.
            return initial
        }
        return network(clean(uri),headers,l,range,null,reserved)
    }
    private fun network(url:String,headers:Map<String,String>,oldLease:Lease,range:String?,ifRange:String?,reserved:Boolean=false):ConnectMediaReply{
        val s=oldLease.scope;val id=oldLease.id;var l=oldLease
        synchronized(gate){if(!valid(l)){if(reserved){val n=(flights[key(s,id)]?:1)-1;if(n<=0)flights.remove(key(s,id))else flights[key(s,id)]=n;gate.notifyAll()};return error(403)};if(!reserved)flights[key(s,id)]=(flights[key(s,id)]?:0)+1}
        var released=false
        fun release(){synchronized(gate){if(!released){released=true;val n=(flights[key(s,id)]?:1)-1;if(n<=0)flights.remove(key(s,id))else flights[key(s,id)]=n;gate.notifyAll()}}}
        val c=java.net.URL(url).openConnection() as java.net.HttpURLConnection
        try{
            c.instanceFollowRedirects=false;c.connectTimeout=8000;c.readTimeout=15000;c.useCaches=false;c.setRequestProperty("Accept-Encoding","identity")
            for((name,value)in headers)if(name.lowercase() in setOf("authorization","apikey","accept")&&value.length<=32768)c.setRequestProperty(name,value)
            if(range!=null)c.setRequestProperty("Range",range);if(ifRange!=null)c.setRequestProperty("If-Range",ifRange)
            val status=c.responseCode
            val resultHeaders=mutableMapOf<String,String>();for(name in listOf("ETag","Last-Modified","Content-Range","Content-Length","Content-Disposition","Accept-Ranges","Content-Type"))c.getHeaderField(name)?.let{resultHeaders[name]=it};resultHeaders["Cache-Control"]="private, no-store"
            val type=(c.contentType?:"application/octet-stream").substringBefore(';').lowercase();val stream=if(status>=400)c.errorStream?:java.io.ByteArrayInputStream(byteArrayOf()) else c.inputStream
            val match=Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(c.getHeaderField("Content-Range").orEmpty());val start=if(status==206)match?.groupValues?.get(1)?.toLongOrNull()?:-1 else 0L
            val expected=if(status==206)match?.let{it.groupValues[2].toLong()-start+1}?:-1 else c.getHeaderFieldLong("Content-Length",-1)
            val total=if(status==206)match?.groupValues?.get(3)?.toLongOrNull()?:-1 else expected
            val tag=c.getHeaderField("ETag").orEmpty();val cacheable=status in listOf(200,206)&&start>=0&&total<=minOf(maxFile,s.limit)&&!type.startsWith("text/html")&&!type.startsWith("application/json")&&(status!=206||expected>0&&total>0&&start+expected<=total)
            if(!cacheable){release();val pass=object:java.io.FilterInputStream(stream){override fun close(){try{super.close()}finally{c.disconnect()}}};return ConnectMediaReply(if(status in 300..399)502 else status,type,resultHeaders,pass)}
            fun uncached():ConnectMediaReply{release();return ConnectMediaReply(status,type,resultHeaders,object:java.io.FilterInputStream(stream){override fun close(){try{super.close()}finally{c.disconnect()}}})}
            try{synchronized(gate){
                if(!valid(l,type)){stream.close();c.disconnect();release();return error(403)}
                val previous=read(s,id)
                if(previous!=null&&(!strong(tag)||previous.tag!=tag||previous.total!=total))remove(s,id)
                l=lease(s,id);if(read(s,id)==null)save(s,Meta(id,type,tag,total,false,System.currentTimeMillis(),versions[key(s,id)].orEmpty(),mutableListOf()))
            }
            }catch(_:Exception){return uncached()}
            val file=try{java.io.RandomAccessFile(path(s,id,".bytes"),"rw").apply{seek(start)}}catch(_:Exception){return uncached()};var seen=0L;var committed=0L;var closed=false;var writable=true
            fun checkpoint(eof:Boolean){
                if(eof&&expected>=0&&seen!=expected)throw java.io.IOException("Truncated media body")
                synchronized(gate){if(!writable||!valid(l,type))return
                    try{val m=read(s,id)?:Meta(id,type,tag,total,false,System.currentTimeMillis(),versions[key(s,id)].orEmpty(),mutableListOf())
                        if(seen>0){file.fd.sync();val spans=merged(m.ranges+listOf(start..(start+seen-1)));m.ranges.clear();m.ranges.addAll(spans);if(eof&&m.total<0)m.total=seen;m.used=System.currentTimeMillis();val coherent=strong(tag)||(start==0L&&(eof||expected>=0&&seen==expected));m.complete=coherent&&m.total>0&&m.ranges.size==1&&m.ranges[0].first==0L&&m.ranges[0].last==m.total-1;save(s,m);committed=seen;trim(s,id)}
                    }catch(_:Exception){writable=false}
                }
            }
            val body=object:java.io.InputStream(){
                override fun read():Int{val a=ByteArray(1);return if(read(a,0,1)<0)-1 else a[0].toInt() and 255}
                override fun read(b:ByteArray,off:Int,len:Int):Int{
                    synchronized(gate){if(!authorized(l))throw java.io.IOException("Media account changed")}
                    return try{val n=stream.read(b,off,len);if(n<0){checkpoint(true);close();-1}else{if(expected>=0&&seen+n>expected)throw java.io.IOException("Oversized media range");synchronized(gate){if(!authorized(l))throw java.io.IOException("Media account changed");if(!valid(l,type))writable=false;if(start+seen+n>minOf(maxFile,s.limit))writable=false;if(writable)try{file.write(b,off,n)}catch(_:Exception){writable=false};seen+=n};if(seen-committed>=256*1024||expected>=0&&seen==expected)checkpoint(false);n}}catch(e:Exception){close();throw e}
                }
                override fun close(){if(closed)return;closed=true;try{checkpoint(false)}finally{try{try{file.close()}catch(_:java.io.IOException){}}finally{try{stream.close()}finally{c.disconnect();release()}}}}
            }
            return ConnectMediaReply(status,type,resultHeaders,body)
        }catch(e:Exception){c.disconnect();release();throw e}
    }
}
