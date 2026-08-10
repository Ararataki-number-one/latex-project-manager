package com.zqy.latexviewer.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureTokenStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun save(token: String) {
        val normalized = token.trim()
        if (normalized.isEmpty()) {
            clear()
            return
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(normalized.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(KEY_VALUE, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply()
    }

    fun read(): String? {
        val iv = preferences.getString(KEY_IV, null) ?: return null
        val encrypted = preferences.getString(KEY_VALUE, null) ?: return null
        return runCatching {
            val secretKey = keyStore.getKey(KEY_ALIAS, null) as SecretKey
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey,
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
            )
            String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
        }.getOrElse {
            clear()
            null
        }
    }

    fun hasToken(): Boolean = read() != null

    fun clear() {
        preferences.edit().remove(KEY_IV).remove(KEY_VALUE).apply()
    }

    private fun getOrCreateKey(): SecretKey {
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false)
                    .build()
            )
            generateKey()
        }
    }

    private companion object {
        const val PREFERENCES = "github_credentials"
        const val KEY_ALIAS = "latex_project_viewer_token"
        const val KEY_IV = "token_iv"
        const val KEY_VALUE = "token_value"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
