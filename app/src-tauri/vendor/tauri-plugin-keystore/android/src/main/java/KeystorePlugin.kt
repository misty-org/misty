package app.tauri.keystore

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StoreRequest {
    lateinit var value: String
}

@InvokeArg
class RetrieveRequest {
    lateinit var service: String
    lateinit var user: String
}

@InvokeArg
class RemoveRequest {
    lateinit var service: String
    lateinit var user: String
}

@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {
    private val secureTokenStore = SecureTokenStore(activity)

    @Command
    fun store(invoke: Invoke) {
        try {
            val request = invoke.parseArgs(StoreRequest::class.java)
            secureTokenStore.store(request.value)
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("Could not store the account token securely")
        }
    }

    @Command
    fun retrieve(invoke: Invoke) {
        try {
            invoke.parseArgs(RetrieveRequest::class.java)
            val result = JSObject()
            result.put("value", secureTokenStore.retrieve())
            invoke.resolve(result)
        } catch (_: Exception) {
            invoke.reject("Could not retrieve the account token securely")
        }
    }

    @Command
    fun remove(invoke: Invoke) {
        try {
            invoke.parseArgs(RemoveRequest::class.java)
            secureTokenStore.remove()
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("Could not clear the account token securely")
        }
    }

}
