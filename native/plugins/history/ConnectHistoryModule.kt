package com.connect.messenger

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.database.Cursor
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal class AndroidHistoryDb(context:Context):HistoryDb {
    private val helper=object:SQLiteOpenHelper(context,"connect-history-v1.sqlite",null,1){
        override fun onCreate(db:SQLiteDatabase){HistoryStore.schema.forEach{db.execSQL(it)}}
        override fun onUpgrade(db:SQLiteDatabase,old:Int,new:Int){error("Unsupported history schema upgrade")}
        override fun onConfigure(db:SQLiteDatabase){db.setForeignKeyConstraintsEnabled(true)}
    }
    init{helper.setWriteAheadLoggingEnabled(true)}
    override fun execute(sql:String,args:List<Any?>){helper.writableDatabase.execSQL(sql,args.toTypedArray())}
    override fun query(sql:String,args:List<Any?>):List<Map<String,Any?>>{
        return helper.readableDatabase.rawQuery(sql,args.map{it?.toString()?:""}.toTypedArray()).use{cursor->
            buildList{while(cursor.moveToNext())add(cursor.columnNames.mapIndexed{i,name->name to when(cursor.getType(i)){
                Cursor.FIELD_TYPE_NULL->null;Cursor.FIELD_TYPE_BLOB->cursor.getBlob(i);Cursor.FIELD_TYPE_INTEGER->cursor.getLong(i);Cursor.FIELD_TYPE_FLOAT->cursor.getDouble(i);else->cursor.getString(i)
            }}.toMap())}
        }
    }
    override fun <T> transaction(block:()->T):T{
        val db=helper.writableDatabase
        if(db.inTransaction())return block()
        db.beginTransaction();try{val value=block();db.setTransactionSuccessful();return value}finally{db.endTransaction()}
    }
    fun compact(){query("PRAGMA wal_checkpoint(TRUNCATE)");helper.writableDatabase.execSQL("VACUUM")}
    fun close(){helper.close()}
}

/** A random data key is wrapped by Android Keystore once. Per-message crypto
 * stays off the UI thread and avoids hundreds of hardware-keystore IPC calls.
 * This protects local cache only and is not end-to-end message encryption.
 */
internal class AndroidHistoryCodec(context:Context):HistoryCodec {
    private val key:SecretKeySpec
    init{
        val ks=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        val alias="ConnectHistoryWrapV1"
        val wrapping=if(ks.containsAlias(alias))ks.getKey(alias,null)else KeyGenerator.getInstance("AES","AndroidKeyStore").apply{
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
        val prefs=context.getSharedPreferences("connect_history_keys",0)
        val saved=prefs.getString("wrapped",null)
        val aad="ConnectHistoryDataV1".toByteArray()
        val raw=if(saved!=null){val data=Base64.decode(saved,Base64.NO_WRAP);Cipher.getInstance("AES/GCM/NoPadding").run{init(Cipher.DECRYPT_MODE,wrapping,GCMParameterSpec(128,data.copyOfRange(0,12)));updateAAD(aad);doFinal(data.copyOfRange(12,data.size))}}
        else{val data=ByteArray(32).also{SecureRandom().nextBytes(it)};val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,wrapping);cipher.updateAAD(aad);check(prefs.edit().putString("wrapped",Base64.encodeToString(cipher.iv+cipher.doFinal(data),Base64.NO_WRAP)).commit());data}
        key=SecretKeySpec(raw,"AES");raw.fill(0)
    }
    override fun seal(owner:String,id:String,value:String):ByteArray{
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD("$owner:$id".toByteArray());return cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    }
    override fun open(owner:String,id:String,value:ByteArray):String{
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,value.copyOfRange(0,12)));cipher.updateAAD("$owner:$id".toByteArray());return String(cipher.doFinal(value.copyOfRange(12,value.size)),Charsets.UTF_8)
    }
}

class ConnectHistoryModule(private val context:ReactApplicationContext):ReactContextBaseJavaModule(context){
    private val worker=Executors.newSingleThreadExecutor()
    private val database by lazy{AndroidHistoryDb(context)}
    private val store by lazy{HistoryStore(database,AndroidHistoryCodec(context))}
    private data class Pending(val owner:String,val chat:String,val snapshot:HistorySnapshot,var offset:Int=0,val created:Long=System.currentTimeMillis())
    private val snapshots=mutableMapOf<String,Pending>()
    @Volatile private var destroyed=false
    override fun getName()="ConnectHistory"
    private fun uuid(value:String):String{require(value.matches(Regex("[a-fA-F0-9-]{36}")));return value}
    private fun limitBytes():Long=when(context.getSharedPreferences("connect_history_storage",0).getString("limit","auto")){"1000"->1024L*1024*1024;"2000"->2L*1024*1024*1024;else->500L*1024*1024}
    private fun packet(token:String,pending:Pending):JSONObject{
        check(store.epoch(pending.owner)==pending.snapshot.epoch){"Кеш был очищен"}
        val rows=JSONArray();var bytes=0
        while(pending.offset<pending.snapshot.messages.size){
            val message=pending.snapshot.messages[pending.offset]
            if(store.retired(pending.owner,message.id)){pending.offset++;continue}
            val size=message.json.toByteArray(Charsets.UTF_8).size
            if(rows.length()>0&&bytes+size>80000)break
            require(size<=90000){"Запись истории слишком велика"}
            rows.put(JSONObject(message.json));bytes+=size;pending.offset++
        }
        val more=pending.offset<pending.snapshot.messages.size
        if(!more)snapshots.remove(token)
        return JSONObject().put("messages",rows).put("readAt",pending.snapshot.readAt).put("savedAt",pending.snapshot.savedAt).put("epoch",pending.snapshot.epoch).put("hasMore",pending.snapshot.hasOlder).put("hasNewer",pending.snapshot.hasNewer).put("continuation",if(more)token else JSONObject.NULL)
    }
    private fun catalogKey(data:JSONObject):String{
        val key=data.getString("key")
        require(HistoryCatalogPolicy.key(key))
        return key
    }
    // Metadata only. The bridge cannot persist credentials or expiring URLs.
    private fun safeCatalog(value:Any?,depth:Int=0){
        require(depth<=12)
        when(value){
            is JSONObject->{for(key in value.keys()){
                require(HistoryCatalogPolicy.property(key))
                safeCatalog(value.opt(key),depth+1)
            }}
            is JSONArray->{require(value.length()<=300);for(i in 0 until value.length())safeCatalog(value.opt(i),depth+1)}
            is String->{require(HistoryCatalogPolicy.string(value))}
        }
    }
    private fun catalogValue(owner:String,key:String,value:JSONObject):JSONObject{
        if(key=="inbox")return value
        val parts=key.split(':');val prefix=parts[1]+"/"+parts[2]+"/";val rows=value.getJSONArray("items");val kept=JSONArray()
        require(rows.length()<=100)
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val path=row.getString("path")
            require(path.startsWith(prefix)&&!path.contains("://")&&!path.contains("..")&&!path.contains('?')&&!path.contains('\\'))
            if(!store.retired(owner,"profile:$path"))kept.put(row)
        }
        return JSONObject().put("items",kept)
    }
    @ReactMethod fun execute(owner:String,command:String,payload:String,promise:Promise){
        if(destroyed){promise.reject("HISTORY_CLOSED","Хранилище закрыто");return}
        worker.execute{try{
            uuid(owner);check(!destroyed&&ConnectCallSession.peekOwner(context)==owner){"Аккаунт изменился"}
            require(payload.length<=128*1024)
            val data=JSONObject(payload)
            snapshots.entries.removeAll{it.value.created<System.currentTimeMillis()-30000||it.value.owner!=owner}
            val result:Any=when(command){
                "catalog-read"->{val value=store.catalogRead(owner,catalogKey(data));JSONObject().put("value",value?.let{catalogValue(owner,catalogKey(data),JSONObject(it))}?:JSONObject.NULL).put("epoch",store.epoch(owner))}
                "catalog-write"->{val key=catalogKey(data);val value=data.getJSONObject("value");safeCatalog(value);val stored=store.catalogWrite(owner,key,catalogValue(owner,key,value).toString(),data.getLong("epoch"));store.trim(limitBytes()/5);JSONObject().put("stored",stored)}
                "catalog-retire"->{val key=catalogKey(data);require(key.startsWith("profile:"));val parts=key.split(':');val path=data.getString("path");require(path.startsWith(parts[1]+"/"+parts[2]+"/")&&HistoryCatalogPolicy.string(path)&&!path.contains("..")&&!path.contains('?'));store.drop(owner,"profile:$path");JSONObject().put("ok",true)}
                "catalog-drop"->{store.catalogDrop(owner,catalogKey(data));JSONObject().put("ok",true)}
                "read","page"->{
                    val chat=uuid(data.getString("conversationId"))
                    val before=if(command=="page")data.getString("before")else null
                    val beforeId=if(command=="page")uuid(data.getString("beforeId"))else null
                    val snapshot=store.read(owner,chat,if(command=="page")120 else 200,before,beforeId,data.optString("direction")=="after")
                    if(snapshots.size>=4)snapshots.remove(snapshots.keys.first())
                    val token=UUID.randomUUID().toString();val pending=Pending(owner,chat,snapshot);snapshots[token]=pending;packet(token,pending)
                }
                "chunk"->{val token=uuid(data.getString("continuation"));val pending=snapshots[token]?:error("Локальная история обновилась");check(pending.owner==owner);packet(token,pending)}
                "write"->{
                    val chat=uuid(data.getString("conversationId"));val input=data.getJSONArray("messages");require(input.length()<=500)
                    val messages=(0 until input.length()).map{i->val row=input.getJSONObject(i);val created=row.getString("created_at");HistoryMessage(uuid(row.getString("id")),uuid(row.getString("conversation_id")),created,row.toString(),!row.isNull("deleted_at"),row.optString("edited_at").takeUnless{it.isBlank()||it=="null"}?:created,uuid(row.getString("sender_id")))}
                    val ok=store.write(owner,chat,messages,data.optString("readAt"),data.getLong("epoch"));store.trim(limitBytes()/5);JSONObject().put("stored",ok)
                }
                "drop"->{val id=uuid(data.getString("messageId"));database.transaction{store.drop(owner,id)};JSONObject().put("ok",true)}
                "wipe"->{val chat=data.optString("conversationId").takeIf{it.isNotEmpty()}?.let(::uuid);val epoch=store.clear(owner,chat);snapshots.clear();database.compact();JSONObject().put("epoch",epoch)}
                "stats"->{val stats=JSONObject(store.stats(owner));val avatars=java.io.File(context.filesDir,"connect-avatars").walkTopDown().filter{it.isFile}.sumOf{it.length()};stats.put("nativeSystemBytes",avatars)}
                "limit"->{val value=data.getString("limit");require(value in listOf("auto","500","1000","2000"));context.getSharedPreferences("connect_history_storage",0).edit().putString("limit",value).apply();store.trim(limitBytes()/5);JSONObject().put("ok",true)}
                else->error("Недопустимая команда истории")
            }
            check(!destroyed&&ConnectCallSession.peekOwner(context)==owner){"Аккаунт изменился"}
            promise.resolve(result.toString())
        }catch(_:Exception){promise.reject("HISTORY_STORAGE","Локальная история недоступна. Переписка загрузится с сервера.")}}
    }
    override fun invalidate(){destroyed=true;worker.execute{snapshots.clear();database.close()};worker.shutdown();super.invalidate()}
}
class ConnectHistoryPackage:ReactPackage{
    override fun createNativeModules(context:ReactApplicationContext)=listOf<NativeModule>(ConnectHistoryModule(context))
    override fun createViewManagers(context:ReactApplicationContext)=emptyList<ViewManager<*,*>>()
}
