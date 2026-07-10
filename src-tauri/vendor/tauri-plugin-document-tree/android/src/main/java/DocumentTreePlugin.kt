package app.tauri.documenttree

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import androidx.activity.result.ActivityResult

@InvokeArg
class PickTreeRequest {
    var initialDirectory: String? = null
}

@InvokeArg
class ListChildrenRequest {
    lateinit var treeUri: String
    var documentId: String? = null
}

@InvokeArg
class ReleaseTreeRequest {
    lateinit var uri: String
}

@TauriPlugin
class DocumentTreePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun pickTree(invoke: Invoke) {
        val request = invoke.parseArgs(PickTreeRequest::class.java)
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
            initialDirectoryUri(request.initialDirectory)?.let { uri ->
                putExtra(DocumentsContract.EXTRA_INITIAL_URI, uri)
            }
        }
        startActivityForResult(invoke, intent, "documentTreeResult")
    }

    @Command
    fun allFilesAccessStatus(invoke: Invoke) {
        invoke.resolve(allFilesAccessStatusResult())
    }

    @Command
    fun openAllFilesAccessSettings(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            invoke.resolve(allFilesAccessStatusResult())
            return
        }

        val appSettingsIntent = Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:${activity.packageName}"),
        )
        val fallbackIntent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
        try {
            activity.startActivity(appSettingsIntent)
        } catch (_: ActivityNotFoundException) {
            activity.startActivity(fallbackIntent)
        }
        invoke.resolve(allFilesAccessStatusResult())
    }

    @ActivityCallback
    fun documentTreeResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("Folder selection was cancelled")
            return
        }

        try {
            val data = result.data ?: throw IllegalStateException("Android did not return a folder")
            val uri = data.data ?: throw IllegalStateException("Android did not return a folder URI")
            val grantedFlags = data.flags and (
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            if (grantedFlags == 0) throw IllegalStateException("Android did not grant folder access")
            activity.contentResolver.takePersistableUriPermission(uri, grantedFlags)
            invoke.resolve(locationResult(uri, grantedFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0))
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not retain access to the selected folder")
        }
    }

    @Command
    fun persistedTrees(invoke: Invoke) {
        try {
            val trees = JSArray()
            activity.contentResolver.persistedUriPermissions
                .filter { permission -> permission.isReadPermission }
                .forEach { permission ->
                    trees.put(locationResult(permission.uri, permission.isWritePermission))
                }
            invoke.resolve(JSObject().apply { put("trees", trees) })
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not read granted folders")
        }
    }

    @Command
    fun listChildren(invoke: Invoke) {
        try {
            val request = invoke.parseArgs(ListChildrenRequest::class.java)
            val treeUri = Uri.parse(request.treeUri)
            val parentDocumentId = request.documentId ?: DocumentsContract.getTreeDocumentId(treeUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
            val columns = arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                DocumentsContract.Document.COLUMN_FLAGS,
            )
            val entries = JSArray()
            activity.contentResolver.query(childrenUri, columns, null, null, null)?.use { cursor ->
                val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mimeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
                val sizeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
                val modifiedIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                val flagsIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_FLAGS)
                while (cursor.moveToNext()) {
                    val mimeType = cursor.getString(mimeIndex)
                    val entry = JSObject()
                    entry.put("documentId", cursor.getString(idIndex))
                    entry.put("name", cursor.getString(nameIndex) ?: "Untitled")
                    entry.put("mimeType", mimeType)
                    entry.put("isDirectory", DocumentsContract.Document.MIME_TYPE_DIR == mimeType)
                    if (!cursor.isNull(sizeIndex)) entry.put("sizeBytes", cursor.getLong(sizeIndex))
                    if (!cursor.isNull(modifiedIndex)) entry.put("modifiedMs", cursor.getLong(modifiedIndex))
                    val flags = cursor.getInt(flagsIndex)
                    entry.put("canWrite", flags and DocumentsContract.Document.FLAG_SUPPORTS_WRITE != 0)
                    entries.put(entry)
                }
            } ?: throw IllegalStateException("The selected folder is no longer available")
            invoke.resolve(JSObject().apply { put("entries", entries) })
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not list the selected folder")
        }
    }

    @Command
    fun releaseTree(invoke: Invoke) {
        try {
            val request = invoke.parseArgs(ReleaseTreeRequest::class.java)
            activity.contentResolver.releasePersistableUriPermission(
                Uri.parse(request.uri),
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Could not remove folder access")
        }
    }

    private fun locationResult(uri: Uri, canWrite: Boolean): JSObject {
        val documentId = DocumentsContract.getTreeDocumentId(uri)
        return JSObject().apply {
            put("uri", uri.toString())
            put("documentId", documentId)
            put("name", displayName(uri, documentId))
            put("canWrite", canWrite)
        }
    }

    private fun allFilesAccessStatusResult(): JSObject {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            true
        }
        return JSObject().apply {
            put("granted", granted)
            put("canRequest", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            put("storageRoot", Environment.getExternalStorageDirectory().absolutePath)
        }
    }

    private fun displayName(treeUri: Uri, documentId: String): String {
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        activity.contentResolver.query(
            documentUri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && !cursor.isNull(index)) return cursor.getString(index)
            }
        }
        return documentId.substringAfter(':').ifBlank { "Selected folder" }
    }

    private fun initialDirectoryUri(initialDirectory: String?): Uri? {
        val normalized = initialDirectory
            ?.trim()
            ?.trim('/')
            ?.takeIf { value -> value.isNotEmpty() }
            ?: return null
        if (normalized.contains("..") || normalized.contains('\\')) return null

        val documentId = "primary:$normalized"
        return DocumentsContract.buildDocumentUri(
            "com.android.externalstorage.documents",
            documentId,
        )
    }
}
