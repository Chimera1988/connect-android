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
}
