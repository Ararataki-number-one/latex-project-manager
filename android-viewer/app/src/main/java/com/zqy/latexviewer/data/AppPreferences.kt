package com.zqy.latexviewer.data

import android.content.Context

class AppPreferences(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

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
    }
}
