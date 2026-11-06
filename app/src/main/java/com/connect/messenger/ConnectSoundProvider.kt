package com.connect.messenger

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

/** Only serves explicitly imported sounds; no other application data is exposed. */
class ConnectSoundProvider : ContentProvider() {
    override fun onCreate(): Boolean = true
    override fun getType(uri: Uri): String {
        val name = uri.lastPathSegment ?: return "audio/*"
        return context?.getSharedPreferences("connect_push", android.content.Context.MODE_PRIVATE)
            ?.getString("mime_$name", null)?.takeIf { it.startsWith("audio/") } ?: "audio/*"
    }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r" || uri.pathSegments.size != 1) throw FileNotFoundException()
        val name = uri.lastPathSegment ?: throw FileNotFoundException()
        if (!Regex("[a-f0-9-]{36}\\.audio").matches(name)) throw FileNotFoundException()
        val file = File(context?.filesDir, "sounds/$name")
        if (!file.isFile) throw FileNotFoundException()
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
}
