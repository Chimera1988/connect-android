package com.connect.messenger

import org.junit.Assert.*
import org.junit.Test
import java.sql.DriverManager
import java.nio.file.Files
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal class JdbcHistoryDb(path:String):HistoryDb{
    private val connection=DriverManager.getConnection("jdbc:sqlite:$path")
    override fun execute(sql:String,args:List<Any?>){connection.prepareStatement(sql).use{s->args.forEachIndexed{i,a->s.setObject(i+1,a)};s.executeUpdate()}}
    override fun query(sql:String,args:List<Any?>):List<Map<String,Any?>>{return connection.prepareStatement(sql).use{s->args.forEachIndexed{i,a->s.setObject(i+1,a)};s.executeQuery().use{r->buildList{while(r.next())add((1..r.metaData.columnCount).associate{r.metaData.getColumnLabel(it) to r.getObject(it)})}}}}
    override fun <T> transaction(block:()->T):T{if(!connection.autoCommit)return block();connection.autoCommit=false;try{val v=block();connection.commit();return v}catch(e:Throwable){connection.rollback();throw e}finally{connection.autoCommit=true}}
    fun close(){connection.close()}
}
internal class TestHistoryCodec:HistoryCodec{
    private val key=SecretKeySpec(ByteArray(32){(it+1).toByte()},"AES")
    override fun seal(owner:String,id:String,value:String):ByteArray{val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);c.updateAAD("$owner:$id".toByteArray());return c.iv+c.doFinal(value.toByteArray())}
    override fun open(owner:String,id:String,value:ByteArray):String{val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,value.copyOfRange(0,12)));c.updateAAD("$owner:$id".toByteArray());return String(c.doFinal(value.copyOfRange(12,value.size)))}
}
class HistoryStoreTest{
    private val date="2026-11-10T00:00:00.000000Z"
    private fun message(n:Int,body:String="confirmed-$n",revision:String=date)=HistoryMessage(n.toString().padStart(8,'0'),"chat",date,body,false,revision)
    @Test fun unreadWindowOpensAtTheReadBoundaryAndCanContinueForward(){
        val db=JdbcHistoryDb(":memory:");try{val store=HistoryStore(db,TestHistoryCodec());val base=java.time.Instant.parse(date)
            val rows=(0 until 1000).map{n->val t=base.plusSeconds(n.toLong()).toString();HistoryMessage(n.toString().padStart(8,'0'),"chat",t,"row-$n",false,t,"peer")}
            store.write("one","chat",rows,base.plusSeconds(100).toString(),store.epoch("one"))
            val window=store.read("one","chat",200);assertTrue(window.hasOlder);assertTrue(window.hasNewer);assertEquals(200,window.messages.size)
            assertTrue(window.messages.any{it.id=="00000101"});assertEquals("00000071",window.messages.first().id)
            val last=window.messages.last();val next=store.read("one","chat",120,last.created,last.id,true)
            assertEquals(120,next.messages.size);assertTrue(next.messages.first().id>last.id)
        }finally{db.close()}
    }
    @Test fun realSqlitePersistsAndPagesIdenticalTimestampsWithoutDuplication(){
        val file=Files.createTempFile("connect-history-test-",".sqlite");val codec=TestHistoryCodec()
        try{
            JdbcHistoryDb(file.toString()).let{db->val store=HistoryStore(db,codec);store.write("one","chat",(0 until 1000).map{message(it)},date,store.epoch("one"));db.close()}
            JdbcHistoryDb(file.toString()).let{db->val store=HistoryStore(db,codec);val latest=store.read("one","chat");assertEquals(500,latest.messages.size);assertTrue(latest.hasOlder)
                val older=store.read("one","chat",500,latest.messages.first().created,latest.messages.first().id)
                assertEquals(500,older.messages.size);assertFalse(older.hasOlder);assertEquals(1000,(older.messages+latest.messages).map{it.id}.toSet().size)
                assertEquals(date,latest.readAt);assertTrue(store.read("other","chat").messages.isEmpty());db.close()}
        }finally{Files.deleteIfExists(file)}
    }
    @Test fun clearInvalidatesQueuedWritesAndRetainsDeletionBarriers(){
        val db=JdbcHistoryDb(":memory:");try{val store=HistoryStore(db,TestHistoryCodec());val old=store.epoch("one")
            store.write("one","chat",listOf(message(1)),date,old);store.drop("one",message(2).id)
            val fresh=store.clear("one");assertTrue(fresh>old)
            assertFalse(store.write("one","chat",listOf(message(1)),date,old))
            assertTrue(store.write("one","chat",listOf(message(2)),date,fresh));assertTrue(store.read("one","chat").messages.isEmpty())
            assertTrue(store.write("other","chat",listOf(message(2)),date,store.epoch("other")));assertEquals(1,store.read("other","chat").messages.size)
        }finally{db.close()}
    }
    @Test fun lateOldSnapshotCannotOverwriteAnEditOrRegressReadPosition(){
        val db=JdbcHistoryDb(":memory:");try{val store=HistoryStore(db,TestHistoryCodec());val epoch=store.epoch("one");val later="2026-11-10T01:00:00Z"
            store.write("one","chat",listOf(message(1,"edited",later)),later,epoch)
            store.write("one","chat",listOf(message(1,"old")),date,epoch)
            val snapshot=store.read("one","chat");assertEquals("edited",snapshot.messages.single().json);assertEquals(later,snapshot.readAt)
        }finally{db.close()}
    }
    @Test fun corruptCiphertextIsRefetchedWithoutCrossAccountPlaintextLeak(){
        val db=JdbcHistoryDb(":memory:");try{val store=HistoryStore(db,TestHistoryCodec());store.write("one","chat",listOf(message(1)),date,store.epoch("one"))
            val blob=db.query("SELECT payload FROM history_messages").single()["payload"] as ByteArray
            assertFalse(String(blob).contains("confirmed"))
            store.write("other","chat",listOf(message(1)),date,store.epoch("other"))
            db.execute("UPDATE history_messages SET payload=? WHERE owner=?",listOf(blob,"other"))
            assertTrue(store.read("other","chat").messages.isEmpty());assertEquals(1,store.read("one","chat").messages.size)
        }finally{db.close()}
    }
    @Test fun failedBatchRollsBackAndTrimmingNeverErasesTheRetirementBarrier(){
        val db=JdbcHistoryDb(":memory:");try{val store=HistoryStore(db,TestHistoryCodec());val epoch=store.epoch("one")
            try{store.write("one","chat",listOf(message(1)),"invalid-date",epoch);fail("Expected rollback")}catch(_:java.time.format.DateTimeParseException){}
            assertEquals(0L,store.stats("one")["messages"])
            store.write("one","chat",(0 until 30).map{message(it,"x".repeat(64000))},date,epoch);store.drop("one",message(100).id)
            store.trim(1024*1024);assertTrue(store.stats("one").getValue("bytes")<=1024*1024);assertTrue(store.retired("one",message(100).id))
        }finally{db.close()}
    }
    @Test fun catalogPersistsEncryptedAndIsScopedToViewerAndOwner(){
        val file=Files.createTempFile("connect-catalog-",".sqlite");val codec=TestHistoryCodec();val key="profile:peer:photos"
        try{
            JdbcHistoryDb(file.toString()).let{db->val store=HistoryStore(db,codec);assertTrue(store.catalogWrite("one",key,"private-metadata",store.epoch("one")));assertFalse(String(db.query("SELECT payload FROM history_catalog").single()["payload"] as ByteArray).contains("private-metadata"));db.close()}
            JdbcHistoryDb(file.toString()).let{db->val store=HistoryStore(db,codec);assertEquals("private-metadata",store.catalogRead("one",key));assertNull(store.catalogRead("other",key));val old=store.epoch("one");store.clear("one");assertFalse(store.catalogWrite("one",key,"old-response",old));assertEquals("private-metadata",store.catalogRead("one",key));store.catalogDrop("one",key);assertNull(store.catalogRead("one",key));db.close()}
        }finally{Files.deleteIfExists(file)}
    }
    @Test fun catalogBudgetAndCorruptionNeverEraseAuthOrDeletionBarriers(){
        val db=JdbcHistoryDb(":memory:");try{val store=HistoryStore(db,TestHistoryCodec());val epoch=store.epoch("one");store.drop("one","retired")
            for(n in 0 until 30)store.catalogWrite("one","profile:$n:photos","x".repeat(80000),epoch)
            store.trim(1024*1024);assertTrue(store.stats("one").getValue("bytes")<=1024*1024);assertTrue(store.retired("one","retired"))
            store.catalogWrite("one","inbox","safe",epoch);db.execute("UPDATE history_catalog SET payload=? WHERE catalog=?",listOf(byteArrayOf(1,2,3),"inbox"));assertNull(store.catalogRead("one","inbox"))
        }finally{db.close()}
    }
    @Test fun catalogRejectsSecretsUrlsAndUnknownNamespaces(){
        assertTrue(HistoryCatalogPolicy.key("profile:12345678-1234-1234-1234-123456789012:photos"));assertFalse(HistoryCatalogPolicy.key("auth"))
        for(key in listOf("access_token","refresh_token","authorization","signedUrl","password"))assertFalse(HistoryCatalogPolicy.property(key))
        for(value in listOf("https://host/a?token=secret","/a?token=secret","eyJabc.payload.signature"))assertFalse(HistoryCatalogPolicy.string(value))
        assertTrue(HistoryCatalogPolicy.string("user/photos/file.webp"))
    }

}

// CONNECT_MEDIA_RESPONSE_CACHE_V1: real HTTP, disk, seeking and account fencing.
private class MediaHttpFixture:java.io.Closeable {
    val server=MediaTestHttpServer.create(java.net.InetSocketAddress("127.0.0.1",0),0)
    val origin="http://127.0.0.1:${server.address.port}"
    val hits=java.util.Collections.synchronizedList(mutableListOf<Pair<String,Long>>())
    val data=java.util.concurrent.ConcurrentHashMap<String,ByteArray>()
    @Volatile var tag="\"one\""
    @Volatile var unavailable=false
    @Volatile var truncate=false
    private val pool=java.util.concurrent.Executors.newCachedThreadPool()
    init{server.executor=pool;server.createContext("/"){exchange->
        val value=data[exchange.requestURI.path]
        if(unavailable||value==null){exchange.sendResponseHeaders(503,-1);exchange.close()}else{
            var start=0L;var end=value.size.toLong()-1;var status=200
            val raw=exchange.requestHeaders.getFirst("Range");val condition=exchange.requestHeaders.getFirst("If-Range")
            if(raw!=null&&(condition==null||condition==tag)){
                val match=Regex("bytes=(\\d*)-(\\d*)").matchEntire(raw)
                if(match!=null){val a=match.groupValues[1];val b=match.groupValues[2];start=if(a.isEmpty())maxOf(0,value.size-b.toLong())else a.toLong();end=if(a.isEmpty()||b.isEmpty())value.size.toLong()-1 else minOf(value.size.toLong()-1,b.toLong());status=206}
            }
            val size=end-start+1;hits.add(raw.orEmpty() to size)
            exchange.responseHeaders.add("ETag",tag);exchange.responseHeaders.add("Accept-Ranges","bytes");exchange.responseHeaders.add("Content-Type",if(exchange.requestURI.path.endsWith(".png"))"image/png" else if(exchange.requestURI.path.endsWith(".m4a"))"audio/mp4" else "video/mp4")
            if(status==206)exchange.responseHeaders.add("Content-Range","bytes $start-$end/${value.size}")
            exchange.sendResponseHeaders(status,size+if(truncate)7 else 0)
            try{exchange.responseBody.use{it.write(value,start.toInt(),size.toInt())}}catch(_:java.io.IOException){}finally{exchange.close()}
        }
    };server.start()}
    fun add(name:String,size:Int=512*1024):ByteArray{val bytes=ByteArray(size){(it*31).toByte()};data["/supabase/storage/v1/object/sign/connect-attachments/$name"]=bytes;return bytes}
    fun url(name:String,nonce:String,token:String="first")="$origin/supabase/storage/v1/object/sign/connect-attachments/$name?token=$token&__cm=$nonce"
    override fun close(){server.stop(0);pool.shutdownNow()}
}
class MediaResponseCacheTest {
    private val nonce="0123456789abcdef0123456789abcdef"
    private val next="fedcba9876543210fedcba9876543210"
    private fun consume(reply:ConnectMediaReply?)=requireNotNull(reply).body.use{it.readBytes()}
    private fun fixture(body:(ConnectMediaStore,MediaHttpFixture,java.io.File,java.util.concurrent.atomic.AtomicInteger)->Unit){
        val folder=Files.createTempDirectory("connect-media-test-").toFile();val epoch=java.util.concurrent.atomic.AtomicInteger(1)
        MediaHttpFixture().use{http->try{val cache=ConnectMediaStore(folder,http.origin,{epoch.get()});cache.bind("alice",nonce,500L*1024*1024);body(cache,http,folder,epoch)}finally{folder.deleteRecursively()}}
    }
    @Test fun firstBodyAndOneHundredOfflinePhotoReopensUseOneGet()=fixture{cache,http,_,_->
        val data=http.add("photo.png",5*1024*1024);assertArrayEquals(data,consume(cache.open(http.url("photo.png",nonce))));assertEquals(1,http.hits.size);assertNotNull(cache.lookup("connect-attachments/photo.png"));http.unavailable=true
        repeat(100){assertArrayEquals(data,consume(cache.open(http.url("photo.png",nonce,"expired-$it"))))};assertEquals(1,http.hits.size)
    }
    @Test fun voiceAudioAndVideoRangesNeverRepeatSavedBytesAndBecomeFullyOffline()=fixture{cache,http,_,_->
        for(name in listOf("voice.m4a","audio.m4a","video.mp4","circle.mp4")){
            http.hits.clear();val data=http.add(name);val url=http.url(name,nonce)
            assertArrayEquals(data.copyOfRange(0,1024),consume(cache.open(url,mapOf("Range" to "bytes=0-1023"))));assertNull(cache.lookup("connect-attachments/$name"))
            repeat(20){assertArrayEquals(data.copyOfRange(0,1024),consume(cache.open(url,mapOf("Range" to "bytes=0-1023"))))};assertEquals(1,http.hits.size)
            assertArrayEquals(data.copyOfRange(65536,66560),consume(cache.open(url,mapOf("Range" to "bytes=65536-66559"))))
            assertArrayEquals(data,consume(cache.open(url,mapOf("Range" to "bytes=0-"))));assertNotNull(cache.lookup("connect-attachments/$name"))
            assertEquals(data.size.toLong(),http.hits.sumOf{it.second});assertTrue(http.hits.all{it.first.isNotEmpty()})
            val before=http.hits.size;http.unavailable=true
            assertArrayEquals(data.copyOfRange(data.size-2048,data.size),consume(cache.open(url,mapOf("Range" to "bytes=-2048"))))
            assertArrayEquals(data,consume(cache.open(url)));assertEquals(416,cache.open(url,mapOf("Range" to "bytes=999999999-"))!!.status);assertEquals(before,http.hits.size);http.unavailable=false
        }
    }
    @Test fun partialOrTruncatedFilesAreNeverAdvertisedAsComplete()=fixture{cache,http,_,_->
        val data=http.add("partial.mp4");val url=http.url("partial.mp4",nonce)
        consume(cache.open(url,mapOf("Range" to "bytes=0-1023")));assertNull(cache.lookup("connect-attachments/partial.mp4"));http.unavailable=true
        assertEquals(503,cache.open(url,mapOf("Range" to "bytes=0-"))!!.status);assertNull(cache.lookup("connect-attachments/partial.mp4"));http.unavailable=false
        http.add("truncated.png",4096);http.truncate=true
        try{consume(cache.open(http.url("truncated.png",nonce)));fail("truncated response accepted")}catch(_:java.io.IOException){}
        assertNull(cache.lookup("connect-attachments/truncated.png"));assertEquals(data.size,512*1024)
    }
    @Test fun changedEtagsCannotSpliceOldAndNewRepresentations()=fixture{cache,http,_,_->
        val original=http.add("version.mp4");val url=http.url("version.mp4",nonce)
        consume(cache.open(url,mapOf("Range" to "bytes=0-1023")));http.tag="\"two\"";val replacement=original.map{(it.toInt() xor 85).toByte()}.toByteArray();http.data["/supabase/storage/v1/object/sign/connect-attachments/version.mp4"]=replacement
        assertArrayEquals(replacement,consume(cache.open(url,mapOf("Range" to "bytes=0-"))));assertArrayEquals(replacement,consume(cache.open(url)));assertNotNull(cache.lookup("connect-attachments/version.mp4"))
    }
    @Test fun clearRetireAndVersionChangesInvalidateOnlyTheIntendedFile()=fixture{cache,http,_,_->
        val one=http.add("one.png",4096);val two=http.add("two.png",4096);consume(cache.open(http.url("one.png",nonce)))
        val pending=cache.open(http.url("two.png",nonce))!!
        cache.clear("photos","connect-attachments/one.png",true);assertArrayEquals(two,consume(pending));assertNull(cache.lookup("connect-attachments/one.png"));assertNotNull(cache.lookup("connect-attachments/two.png"));assertEquals(410,cache.open(http.url("one.png",nonce))!!.status);cache.revive("connect-attachments/one.png");assertArrayEquals(one,consume(cache.open(http.url("one.png",nonce))))
        cache.revive("connect-attachments/one.png");assertArrayEquals(one,consume(cache.open(http.url("one.png",nonce))));assertNotNull(cache.lookup("connect-attachments/one.png","v1"));assertNull(cache.lookup("connect-attachments/one.png","v2"));cache.clear("temporary");assertEquals(0L,cache.stats().values.sum())
    }
    @Test fun logoutAndAccountSwitchFenceOldStreamsAndPrivateCacheUrls()=fixture{cache,http,_,epoch->
        val data=http.add("private.png");consume(cache.open(http.url("private.png",nonce)));http.add("pending.mp4");val pending=cache.open(http.url("pending.mp4",nonce))!!;val first=ByteArray(1024);assertEquals(1024,pending.body.read(first))
        epoch.incrementAndGet();cache.bind("bob",next,500L*1024*1024)
        try{pending.body.read(first);fail("old lease read after logout")}catch(_:java.io.IOException){}finally{pending.body.close()}
        assertNull(cache.lookup("connect-attachments/private.png"));assertEquals(403,cache.open(http.url("private.png",nonce))!!.status)
        epoch.incrementAndGet();cache.bind("alice",next,500L*1024*1024);http.unavailable=true;assertArrayEquals(data,consume(cache.open(http.url("private.png",next))));assertNull(cache.lookup("connect-attachments/pending.mp4"))
    }
    @Test fun simultaneousImageConsumersShareTheFirstDownload()=fixture{cache,http,_,_->
        val expected=http.add("parallel.png",256*1024);val executor=java.util.concurrent.Executors.newFixedThreadPool(8);val start=java.util.concurrent.CountDownLatch(1)
        try{val futures=(1..8).map{executor.submit<ByteArray>{start.await();consume(cache.open(http.url("parallel.png",nonce)))}};start.countDown();futures.forEach{assertArrayEquals(expected,it.get(20,java.util.concurrent.TimeUnit.SECONDS))};assertEquals(1,http.hits.size)}finally{executor.shutdownNow()}
    }
    @Test fun lookupAndIdleChatOpeningNeverStartNetworkDownloads()=fixture{cache,http,_,_->
        http.add("big.mp4",2*1024*1024);repeat(100){assertNull(cache.lookup("connect-attachments/big.mp4"))};assertTrue(http.hits.isEmpty())
    }
}


// CONNECT_MEDIA_HTTP_FIX_20261120: only public Android/JVM APIs in unit tests.
private class MediaTestHeaders {
    private val values=linkedMapOf<String,String>()
    fun add(name:String,value:String){values[name.lowercase(java.util.Locale.ROOT)]=value}
    fun getFirst(name:String):String?=values[name.lowercase(java.util.Locale.ROOT)]
    fun lines():String=values.entries.joinToString(""){(key,value)->"$key: $value\r\n"}
}
private class MediaTestExchange(
    val requestURI:java.net.URI,
    val requestHeaders:MediaTestHeaders,
    private val client:java.net.Socket
) {
    val responseHeaders=MediaTestHeaders()
    val responseBody:java.io.OutputStream get()=client.getOutputStream()
    fun sendResponseHeaders(status:Int,length:Long){
        responseHeaders.add("Content-Length",maxOf(0,length).toString())
        val reason=when(status){200->"OK";206->"Partial Content";503->"Service Unavailable";else->"Error"}
        val head="HTTP/1.1 $status $reason\r\nConnection: close\r\n"+responseHeaders.lines()+"\r\n"
        client.getOutputStream().write(head.toByteArray(Charsets.ISO_8859_1))
        client.getOutputStream().flush()
    }
    fun close(){client.close()}
}
private class MediaTestHttpServer private constructor(
    val address:java.net.InetSocketAddress,
    private val listener:java.net.ServerSocket
) {
    lateinit var executor:java.util.concurrent.Executor
    private var callback:((MediaTestExchange)->Unit)?=null
    companion object {
        fun create(address:java.net.InetSocketAddress,backlog:Int):MediaTestHttpServer {
            val listener=java.net.ServerSocket()
            listener.bind(address,maxOf(1,backlog))
            return MediaTestHttpServer(listener.localSocketAddress as java.net.InetSocketAddress,listener)
        }
    }
    fun createContext(path:String,handler:(MediaTestExchange)->Unit){
        require(path=="/")
        callback=handler
    }
    fun start(){
        val handle=requireNotNull(callback)
        executor.execute {
            while(!listener.isClosed){
                val socket=try{listener.accept()}catch(_:java.net.SocketException){break}
                executor.execute {
                    socket.use { connection ->
                        connection.soTimeout=15000
                        try{
                            val reader=java.io.BufferedReader(java.io.InputStreamReader(connection.getInputStream(),Charsets.ISO_8859_1))
                            val request=reader.readLine()?:return@use
                            val parts=request.split(' ')
                            if(parts.size<2)return@use
                            val headers=MediaTestHeaders()
                            while(true){
                                val line=reader.readLine()?:break
                                if(line.isEmpty())break
                                val colon=line.indexOf(':')
                                if(colon>0)headers.add(line.substring(0,colon).trim(),line.substring(colon+1).trim())
                            }
                            handle(MediaTestExchange(java.net.URI(parts[1]),headers,connection))
                        }catch(_:java.io.IOException){
                            // Client cancellations are expected in the partial-range tests.
                        }
                    }
                }
            }
        }
    }
    fun stop(delay:Int){listener.close()}
}
