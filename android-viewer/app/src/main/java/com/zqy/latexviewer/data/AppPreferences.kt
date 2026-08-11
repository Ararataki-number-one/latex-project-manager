package com.zqy.latexviewer.data

import android.content.Context

class AppPreferences(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun savedRepositoryReferences(): List<String> = preferences
        .getStringSet(KEY_REPOSITORIES, emptySet())
        .orEmpty()
        .filter { it.isNotBlank() }
        .sortedWith(String.CASE_INSENSITIVE_ORDER)

    fun addRepository(reference: String) {
        val normalized = reference.trim()
        if (normalized.isEmpty()) return
        val updated = savedRepositoryReferences()
            .filterNot { it.equals(normalized, ignoreCase = true) }
            .plus(normalized)
            .toSet()
        preferences.edit().putStringSet(KEY_REPOSITORIES, updated).apply()
    }

    fun removeRepository(reference: String) {
        val updated = savedRepositoryReferences()
            .filterNot { it.equals(reference, ignoreCase = true) }
            .toSet()
        preferences.edit().putStringSet(KEY_REPOSITORIES, updated).apply()
    }

    var autoCheckUpdates: Boolean
        get() = preferences.getBoolean(KEY_AUTO_CHECK, true)
        set(value) = preferences.edit().putBoolean(KEY_AUTO_CHECK, value).apply()

    var autoDownloadUpdates: Boolean
        get() = preferences.getBoolean(KEY_AUTO_DOWNLOAD, false)
        set(value) = preferences.edit().putBoolean(KEY_AUTO_DOWNLOAD, value).apply()

    private companion object {
        const val PREFERENCES = "viewer_preferences"
        const val KEY_AUTO_CHECK = "auto_check_updates"
        const val KEY_AUTO_DOWNLOAD = "auto_download_updates"
        const val KEY_REPOSITORIES = "saved_repositories"
    }
}
