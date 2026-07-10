package app.tauri.keystore

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureTokenStoreTest {
    private lateinit var context: Context
    private lateinit var store: SecureTokenStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        store = SecureTokenStore(context)
        store.remove()
    }

    @After
    fun tearDown() {
        store.remove()
    }

    @Test
    fun tokenIsEncryptedRoundTripsAndCanBeRemoved() {
        val token = "misty-instrumentation-secret"
        store.store(token)

        val freshStore = SecureTokenStore(context)
        assertEquals(token, freshStore.retrieve())

        val preferences = context.getSharedPreferences(
            SecureTokenStore.PREFERENCES_NAME,
            Context.MODE_PRIVATE,
        )
        assertFalse(preferences.getString(SecureTokenStore.IV_KEY, "").orEmpty().contains(token))
        assertFalse(preferences.getString(SecureTokenStore.CIPHERTEXT_KEY, "").orEmpty().contains(token))

        freshStore.remove()
        assertNull(freshStore.retrieve())
    }
}
