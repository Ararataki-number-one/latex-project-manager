package com.zqy.latexviewer.data

import android.content.Context
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import com.zqy.latexviewer.model.ReadingProgress
import org.json.JSONArray
import org.json.JSONObject

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

    var pdfCacheLimitBytes: Long
        get() = preferences.getLong(KEY_PDF_CACHE_LIMIT, DEFAULT_PDF_CACHE_LIMIT_BYTES)
            .coerceIn(MIN_PDF_CACHE_LIMIT_BYTES, MAX_PDF_CACHE_LIMIT_BYTES)
        set(value) = preferences.edit().putLong(
            KEY_PDF_CACHE_LIMIT,
            value.coerceIn(MIN_PDF_CACHE_LIMIT_BYTES, MAX_PDF_CACHE_LIMIT_BYTES)
        ).apply()

    fun downloadedFiles(): List<DownloadedFile> {
        val raw = preferences.getString(KEY_DOWNLOAD_HISTORY, null) ?: return emptyList()
        return runCatching {
            val values = JSONArray(raw)
            buildList {
                for (index in 0 until values.length()) {
                    val value = values.getJSONObject(index)
                    add(DownloadedFile(
                        name = value.getString("name"),
                        contentUri = value.getString("contentUri"),
                        displayPath = value.getString("displayPath"),
                        mimeType = value.getString("mimeType"),
                        size = value.optLong("size")
                    ))
                }
            }
        }.getOrDefault(emptyList())
    }

    fun saveDownloadedFile(file: DownloadedFile) {
        val updated = (listOf(file) + downloadedFiles().filterNot { it.contentUri == file.contentUri }).take(30)
        val values = JSONArray()
        updated.forEach { item ->
            values.put(JSONObject()
                .put("name", item.name)
                .put("contentUri", item.contentUri)
                .put("displayPath", item.displayPath)
                .put("mimeType", item.mimeType)
                .put("size", item.size))
        }
        preferences.edit().putString(KEY_DOWNLOAD_HISTORY, values.toString()).apply()
    }

    fun isDownloadWorkHandled(workId: String): Boolean = preferences
        .getStringSet(KEY_HANDLED_DOWNLOADS, emptySet())
        .orEmpty()
        .contains(workId)

    fun markDownloadWorkHandled(workId: String) {
        val current = preferences.getStringSet(KEY_HANDLED_DOWNLOADS, emptySet()).orEmpty().toMutableList()
        current.remove(workId)
        current.add(workId)
        preferences.edit().putStringSet(KEY_HANDLED_DOWNLOADS, current.takeLast(100).toSet()).apply()
    }

    fun readingProgress(repositoryFullName: String, pdfPath: String): ReadingProgress? =
        allReadingProgress().firstOrNull {
            it.repositoryFullName.equals(repositoryFullName, ignoreCase = true) && it.pdfPath == pdfPath
        }

    fun mostRecentReading(): ReadingProgress? = allReadingProgress().maxByOrNull(ReadingProgress::lastReadAt)

    fun saveReadingProgress(progress: ReadingProgress) {
        val key = progressKey(progress.repositoryFullName, progress.pdfPath)
        val objectValue = JSONObject()
            .put("schemaVersion", 1)
            .put("repositoryFullName", progress.repositoryFullName)
            .put("projectName", progress.projectName)
            .put("pdfPath", progress.pdfPath)
            .put("pdfName", progress.pdfName)
            .put("sha", progress.sha)
            .put("pageIndex", progress.pageIndex.coerceAtLeast(0))
            .put("pageCount", progress.pageCount.coerceAtLeast(1))
            .put("lastReadAt", progress.lastReadAt)
        preferences.edit().putString("$KEY_READING_PREFIX$key", objectValue.toString()).apply()
    }

    fun allReadingProgress(): List<ReadingProgress> = preferences.all
        .filterKeys { it.startsWith(KEY_READING_PREFIX) }
        .values
        .mapNotNull { raw -> (raw as? String)?.let(::parseReadingProgress) }

    fun cachedMobileIndexes(): Map<String, MobileProjectIndex> = preferences.all
        .filterKeys { it.startsWith(KEY_INDEX_PREFIX) }
        .mapNotNull { (key, raw) ->
            val repository = key.removePrefix(KEY_INDEX_PREFIX)
            val parsed = (raw as? String)?.let(::parseMobileIndex)
            if (repository.isBlank() || parsed == null) null else repository to parsed
        }
        .toMap()

    fun saveMobileIndex(repositoryFullName: String, index: MobileProjectIndex?) {
        val key = "$KEY_INDEX_PREFIX${repositoryFullName.lowercase()}"
        if (index == null) {
            preferences.edit().remove(key).apply()
            return
        }
        val outputs = JSONArray()
        index.outputs.forEach { output ->
            outputs.put(JSONObject()
                .put("id", output.id)
                .put("targetId", output.targetId)
                .put("name", output.name)
                .put("entry", output.entry)
                .put("profileId", output.profileId)
                .put("pdfPath", output.pdfPath))
        }
        val payload = JSONObject()
            .put("schemaVersion", index.schemaVersion)
            .put("projectId", index.projectId)
            .put("name", index.name)
            .put("updatedAt", index.updatedAt)
            .put("defaultOutputId", index.defaultOutputId)
            .put("outputs", outputs)
        preferences.edit().putString(key, payload.toString()).apply()
    }

    private fun parseReadingProgress(raw: String): ReadingProgress? = runCatching {
        val value = JSONObject(raw)
        if (value.optInt("schemaVersion") != 1) return@runCatching null
        ReadingProgress(
            repositoryFullName = value.getString("repositoryFullName"),
            projectName = value.getString("projectName"),
            pdfPath = value.getString("pdfPath"),
            pdfName = value.getString("pdfName"),
            sha = value.getString("sha"),
            pageIndex = value.optInt("pageIndex").coerceAtLeast(0),
            pageCount = value.optInt("pageCount", 1).coerceAtLeast(1),
            lastReadAt = value.optLong("lastReadAt")
        )
    }.getOrNull()

    private fun parseMobileIndex(raw: String): MobileProjectIndex? = runCatching {
        val value = JSONObject(raw)
        if (value.optInt("schemaVersion") != 1) return@runCatching null
        val outputsValue = value.getJSONArray("outputs")
        val outputs = buildList {
            for (index in 0 until outputsValue.length()) {
                val output = outputsValue.getJSONObject(index)
                add(MobilePdfOutput(
                    id = output.getString("id"),
                    targetId = output.getString("targetId"),
                    name = output.getString("name"),
                    entry = output.getString("entry"),
                    profileId = output.optString("profileId").takeIf { it.isNotBlank() && it != "null" },
                    pdfPath = output.getString("pdfPath")
                ))
            }
        }
        MobileProjectIndex(
            schemaVersion = 1,
            projectId = value.getString("projectId"),
            name = value.getString("name"),
            updatedAt = value.getString("updatedAt"),
            defaultOutputId = value.getString("defaultOutputId"),
            outputs = outputs
        ).takeIf { index -> index.defaultOutput != null }
    }.getOrNull()

    private fun progressKey(repositoryFullName: String, pdfPath: String): String =
        "${repositoryFullName.lowercase()}|$pdfPath".hashCode().toUInt().toString(16)

    private companion object {
        const val PREFERENCES = "viewer_preferences"
        const val KEY_AUTO_CHECK = "auto_check_updates"
        const val KEY_AUTO_DOWNLOAD = "auto_download_updates"
        const val KEY_REPOSITORIES = "saved_repositories"
        const val KEY_PDF_CACHE_LIMIT = "pdf_cache_limit_bytes"
        const val KEY_DOWNLOAD_HISTORY = "download_history_v1"
        const val KEY_HANDLED_DOWNLOADS = "handled_downloads_v1"
        const val KEY_READING_PREFIX = "reading_v1:"
        const val KEY_INDEX_PREFIX = "mobile_index_v1:"
        const val DEFAULT_PDF_CACHE_LIMIT_BYTES = 512L * 1024 * 1024
        const val MIN_PDF_CACHE_LIMIT_BYTES = 64L * 1024 * 1024
        const val MAX_PDF_CACHE_LIMIT_BYTES = 4L * 1024 * 1024 * 1024
    }
}
