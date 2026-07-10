package app.tauri.keystore

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class SecureTokenStore(private val context: Context) {
    fun store(value: String) {
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        val stored = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(CIPHERTEXT_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .commit()
        if (!stored) throw IllegalStateException("Secure preferences commit failed")
    }

    fun retrieve(): String? {
        val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val iv = preferences.getString(IV_KEY, null) ?: return null
        val ciphertext = preferences.getString(CIPHERTEXT_KEY, null) ?: return null
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val key = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
            ?: throw IllegalStateException("Secure key is unavailable")
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
        )
        val cleartext = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP))
        return String(cleartext, StandardCharsets.UTF_8)
    }

    fun remove() {
        val cleared = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(IV_KEY)
            .remove(CIPHERTEXT_KEY)
            .commit()
        if (!cleared) throw IllegalStateException("Secure preferences commit failed")
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }.deleteEntry(KEY_ALIAS)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val parameters = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUnlockedDeviceRequired(true)
            .build()
        keyGenerator.init(parameters)
        return keyGenerator.generateKey()
    }

    companion object {
        internal const val PREFERENCES_NAME = "misty_secure_storage"
        internal const val IV_KEY = "account_token_iv"
        internal const val CIPHERTEXT_KEY = "account_token_ciphertext"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "com.misty.mobile.account-token"
        private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
