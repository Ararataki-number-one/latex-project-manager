package com.zqy.latexviewer.data

import android.content.Context
import com.zqy.latexviewer.model.DownloadHistoryKind
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.GlassMode
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import com.zqy.latexviewer.model.PdfBookmark
import com.zqy.latexviewer.model.PersistentDownloadKind
import com.zqy.latexviewer.model.PersistentDownloadState
import com.zqy.latexviewer.model.PersistentDownloadTask
import com.zqy.latexviewer.model.ReadingProgress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Small compatibility facade around Room. General application settings remain in
 * SharedPreferences, while all library/user content lives in [ViewerDatabase].
 * The blocking methods intentionally preserve the v0.10 call surface; ViewModel
 * operations invoke them for small indexed records only.
 */
class AppPreferences(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val dao = ViewerDatabase.get(appContext).viewerDao()

    init {
        migrateLegacyPreferencesOnce()
    }

    fun savedRepositoryReferences(): List<String> = blocking {
        dao.repositories().map(RepositoryEntity::fullName)
    }

    fun repositorySnapshots(): List<GitHubRepository> = blocking {
        dao.repositories().map(RepositoryEntity::toModel)
    }

    fun saveRepositorySnapshot(repository: GitHubRepository) = blocking {
        val previous = dao.repository(repository.fullName)
        dao.upsertRepository(repository.toEntity(saved = previous?.saved ?: true))
    }

    fun addRepository(reference: String) {
        val normalized = reference.trim().removeSuffix(".git")
            .substringAfter("github.com/", reference.trim().removeSuffix(".git"))
            .trim('/')
        if (normalized.isEmpty()) return
        blocking {
            val previous = dao.repository(normalized)
            if (previous != null) {
                dao.upsertRepository(previous.copy(saved = true))
            } else {
                val owner = normalized.substringBefore('/', "")
                val name = normalized.substringAfter('/', normalized)
                dao.upsertRepository(
                    RepositoryEntity(
                        fullName = normalized,
                        name = name,
                        owner = owner,
                        description = null,
                        isPrivate = false,
                        defaultBranch = "main",
                        updatedAt = "",
                        htmlUrl = "https://github.com/$normalized",
                        sizeKb = 0L,
                        commitSha = null,
                        lastSuccessfulRefreshAt = 0L,
                        saved = true
                    )
                )
            }
        }
    }

    fun removeRepository(reference: String) = blocking {
        dao.removeRepository(reference)
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

    var glassMode: GlassMode
        get() = runCatching {
            GlassMode.valueOf(preferences.getString(KEY_GLASS_MODE, GlassMode.AUTO.name).orEmpty())
        }.getOrDefault(GlassMode.AUTO)
        set(value) = preferences.edit().putString(KEY_GLASS_MODE, value.name).apply()

    fun downloadedFiles(): List<DownloadedFile> = blocking {
        dao.downloadHistory(MAX_DOWNLOAD_HISTORY).map(DownloadHistoryEntity::toModel)
    }

    fun saveDownloadedFile(file: DownloadedFile) = blocking {
        val normalized = file.copy(
            id = file.stableId,
            downloadedAt = file.downloadedAt.takeIf { it > 0 } ?: System.currentTimeMillis()
        )
        dao.upsertDownloadHistory(normalized.toEntity())
        dao.trimDownloadHistory(MAX_DOWNLOAD_HISTORY)
    }

    fun removeDownloadedFile(id: String) = blocking { dao.deleteDownloadHistory(id) }

    fun clearDownloadHistory() = blocking { dao.clearDownloadHistory() }

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

    fun readingProgress(repositoryFullName: String, pdfPath: String): ReadingProgress? = blocking {
        dao.readingProgress(documentId(repositoryFullName, pdfPath))?.toModel()
    }

    fun mostRecentReading(): ReadingProgress? = allReadingProgress().firstOrNull()

    fun saveReadingProgress(progress: ReadingProgress) = blocking {
        dao.upsertReadingProgress(progress.toEntity())
    }

    fun allReadingProgress(): List<ReadingProgress> = blocking {
        dao.readingProgress().map(ReadingProgressEntity::toModel)
    }

    fun bookmarks(repositoryFullName: String, pdfPath: String): List<PdfBookmark> = blocking {
        dao.bookmarks(repositoryFullName, normalizePath(pdfPath)).map(PdfBookmarkEntity::toModel)
    }

    fun allBookmarks(): List<PdfBookmark> = blocking {
        dao.allBookmarks().map(PdfBookmarkEntity::toModel)
    }

    fun toggleBookmark(bookmark: PdfBookmark): Boolean = blocking {
        val existing = dao.bookmarks(bookmark.repositoryFullName, normalizePath(bookmark.pdfPath))
            .firstOrNull { it.pageIndex == bookmark.pageIndex }
        if (existing == null) {
            dao.upsertBookmark(bookmark.copy(pdfPath = normalizePath(bookmark.pdfPath)).toEntity())
            true
        } else {
            dao.deleteBookmark(existing.id)
            false
        }
    }

    fun cachedMobileIndexes(): Map<String, MobileProjectIndex> = blocking {
        dao.mobileIndexes().mapNotNull { entity ->
            parseMobileIndex(entity.payload, entity.commitSha)?.let { entity.repositoryFullName.lowercase() to it }
        }.toMap()
    }

    fun saveMobileIndex(repositoryFullName: String, index: MobileProjectIndex?) {
        // A null result is ambiguous (offline, auth, rate limit, or 404). Keep the
        // last known-good index. Call deleteMobileIndex only for a confirmed 404.
        if (index == null) return
        blocking {
            dao.upsertMobileIndex(
                MobileIndexEntity(
                    repositoryFullName = repositoryFullName.lowercase(),
                    payload = encodeMobileIndex(index),
                    commitSha = index.commitSha,
                    lastSuccessfulRefreshAt = System.currentTimeMillis()
                )
            )
        }
    }

    fun deleteMobileIndex(repositoryFullName: String) = blocking {
        dao.deleteMobileIndex(repositoryFullName)
    }

    fun downloadTasks(): List<PersistentDownloadTask> = blocking {
        dao.downloadTasks().map(DownloadTaskEntity::toModel)
    }

    fun saveDownloadTask(task: PersistentDownloadTask, taskPayload: String? = null) = blocking {
        val previous = dao.downloadTask(task.id)
        dao.upsertDownloadTask(task.toEntity(taskPayload ?: previous?.taskPayload))
    }

    fun downloadTask(id: String): Pair<PersistentDownloadTask, String?>? = blocking {
        dao.downloadTask(id)?.let { it.toModel() to it.taskPayload }
    }

    fun activeDownloadTask(uniqueKey: String): Pair<PersistentDownloadTask, String?>? = blocking {
        dao.activeDownloadByUniqueKey(uniqueKey)?.let { it.toModel() to it.taskPayload }
    }

    fun updateDownloadTask(task: PersistentDownloadTask) = saveDownloadTask(task)

    fun savePdfCacheEntry(entity: PdfCacheEntity) = blocking { dao.upsertPdfCache(entity) }

    fun pdfCacheEntries(): List<PdfCacheEntity> = blocking { dao.pdfCacheEntries() }

    fun removePdfCacheEntry(cacheKey: String) = blocking { dao.deletePdfCache(cacheKey) }

    fun clearPdfCacheIndex() = blocking { dao.clearPdfCacheIndex() }

    private fun migrateLegacyPreferencesOnce() {
        if (preferences.getBoolean(KEY_ROOM_MIGRATED, false)) return
        blocking {
            val legacyRepositories = preferences.getStringSet(KEY_REPOSITORIES, emptySet()).orEmpty()
            legacyRepositories.filter(String::isNotBlank).forEach { reference ->
                if (dao.repository(reference) == null) {
                    val owner = reference.substringBefore('/', "")
                    val name = reference.substringAfter('/', reference)
                    dao.upsertRepository(
                        RepositoryEntity(
                            fullName = reference,
                            name = name,
                            owner = owner,
                            description = null,
                            isPrivate = false,
                            defaultBranch = "main",
                            updatedAt = "",
                            htmlUrl = "https://github.com/$reference",
                            sizeKb = 0,
                            commitSha = null,
                            lastSuccessfulRefreshAt = 0,
                            saved = true
                        )
                    )
                }
            }

            parseLegacyDownloadHistory().forEach { dao.upsertDownloadHistory(it.toEntity()) }
            preferences.all.filterKeys { it.startsWith(KEY_READING_PREFIX) }.values
                .mapNotNull { (it as? String)?.let(::parseReadingProgress) }
                .forEach { dao.upsertReadingProgress(it.toEntity()) }
            preferences.all.filterKeys { it.startsWith(KEY_INDEX_PREFIX) }.forEach { (key, raw) ->
                val repository = key.removePrefix(KEY_INDEX_PREFIX).lowercase()
                val payload = raw as? String ?: return@forEach
                parseMobileIndex(payload)?.let { index ->
                    dao.upsertMobileIndex(
                        MobileIndexEntity(repository, encodeMobileIndex(index), index.commitSha, 0L)
                    )
                }
            }
            File(appContext.cacheDir, "pdf-preview").listFiles()
                ?.filter { it.isFile && it.extension.equals("pdf", true) && it.length() > 0 }
                ?.forEach { file ->
                    dao.upsertPdfCache(
                        PdfCacheEntity(
                            cacheKey = file.nameWithoutExtension,
                            localPath = file.absolutePath,
                            size = file.length(),
                            lastAccessAt = file.lastModified().coerceAtLeast(0L),
                            repositoryFullName = null,
                            pdfPath = null,
                            sha = null,
                            knownGood = true
                        )
                    )
                }
        }
        preferences.edit().putBoolean(KEY_ROOM_MIGRATED, true).apply()
    }

    private fun parseLegacyDownloadHistory(): List<DownloadedFile> {
        val raw = preferences.getString(KEY_DOWNLOAD_HISTORY, null)
            ?: preferences.getString(KEY_DOWNLOAD_HISTORY_LEGACY, null)
            ?: return emptyList()
        return runCatching {
            val values = JSONArray(raw)
            buildList {
                for (index in 0 until values.length()) {
                    val value = values.getJSONObject(index)
                    val contentUri = value.getString("contentUri")
                    add(
                        DownloadedFile(
                            name = value.getString("name"),
                            contentUri = contentUri,
                            displayPath = value.getString("displayPath"),
                            mimeType = value.getString("mimeType"),
                            size = value.optLong("size"),
                            id = value.optString("id").takeIf(String::isNotBlank) ?: contentUri,
                            downloadedAt = value.optLong("downloadedAt"),
                            kind = value.optString("kind").takeIf(String::isNotBlank)
                                ?.let { runCatching { DownloadHistoryKind.valueOf(it) }.getOrNull() }
                                ?: DownloadHistoryKind.OTHER,
                            sourceRepository = value.optionalString("sourceRepository"),
                            sourcePath = value.optionalString("sourcePath")
                        )
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun parseReadingProgress(raw: String): ReadingProgress? = runCatching {
        val value = JSONObject(raw)
        ReadingProgress(
            schemaVersion = value.optInt("schemaVersion", 1),
            repositoryFullName = value.getString("repositoryFullName"),
            projectName = value.getString("projectName"),
            pdfPath = normalizePath(value.getString("pdfPath")),
            pdfName = value.getString("pdfName"),
            sha = value.getString("sha"),
            pageIndex = value.optInt("pageIndex").coerceAtLeast(0),
            pageCount = value.optInt("pageCount", 1).coerceAtLeast(1),
            lastReadAt = value.optLong("lastReadAt")
        )
    }.getOrNull()

    companion object {
        fun parseMobileIndex(raw: String, commitSha: String? = null): MobileProjectIndex? = runCatching {
            val value = JSONObject(raw)
            val schemaVersion = value.optInt("schemaVersion", 1)
            if (schemaVersion !in 1..2) return@runCatching null
            val outputsValue = value.optJSONArray("outputs")
                ?: value.optJSONArray("pdfOutputs")
                ?: return@runCatching null
            val outputs = buildList {
                for (index in 0 until outputsValue.length()) {
                    val output = outputsValue.getJSONObject(index)
                    val pdfPath = normalizePath(output.optString("pdfPath", output.optString("path")))
                    if (!isSafePdfPath(pdfPath)) return@runCatching null
                    add(
                        MobilePdfOutput(
                            id = output.optString("id").ifBlank { "output-$index" },
                            targetId = output.optString("targetId", output.optString("target")).ifBlank { "default" },
                            name = output.optString("name").ifBlank { pdfPath.substringAfterLast('/') },
                            entry = output.optString("entry"),
                            profileId = output.optionalString("profileId"),
                            pdfPath = pdfPath
                        )
                    )
                }
            }
            val defaultId = value.optString("defaultOutputId", value.optString("defaultPdfId"))
                .ifBlank { outputs.firstOrNull()?.id.orEmpty() }
            MobileProjectIndex(
                schemaVersion = schemaVersion,
                projectId = value.optString("projectId").ifBlank { value.optString("id") },
                name = value.optString("name").ifBlank { value.optString("displayName") },
                updatedAt = value.optString("updatedAt"),
                defaultOutputId = defaultId,
                outputs = outputs,
                commitSha = commitSha ?: value.optionalString("commitSha")
            ).takeIf { it.outputs.isNotEmpty() && it.defaultOutput != null }
        }.getOrNull()

        fun encodeMobileIndex(index: MobileProjectIndex): String {
            val outputs = JSONArray()
            index.outputs.forEach { output ->
                outputs.put(
                    JSONObject()
                        .put("id", output.id)
                        .put("targetId", output.targetId)
                        .put("name", output.name)
                        .put("entry", output.entry)
                        .put("profileId", output.profileId)
                        .put("pdfPath", normalizePath(output.pdfPath))
                )
            }
            return JSONObject()
                .put("schemaVersion", index.schemaVersion)
                .put("projectId", index.projectId)
                .put("name", index.name)
                .put("updatedAt", index.updatedAt)
                .put("defaultOutputId", index.defaultOutputId)
                .put("outputs", outputs)
                .put("commitSha", index.commitSha)
                .toString()
        }

        fun normalizePath(path: String): String = path.replace('\\', '/').trimStart('/')

        fun isSafePdfPath(path: String): Boolean {
            if (path.isBlank() || path.startsWith('/') || path.startsWith('\\') || WINDOWS_DRIVE.matches(path)) return false
            val parts = path.replace('\\', '/').split('/')
            return parts.none { it.isBlank() || it == "." || it == ".." } && path.endsWith(".pdf", true)
        }

        fun documentId(repositoryFullName: String, pdfPath: String): String =
            "${repositoryFullName.lowercase()}:${normalizePath(pdfPath)}"

        private const val PREFERENCES = "viewer_preferences"
        private const val KEY_AUTO_CHECK = "auto_check_updates"
        private const val KEY_AUTO_DOWNLOAD = "auto_download_updates"
        private const val KEY_REPOSITORIES = "saved_repositories"
        private const val KEY_PDF_CACHE_LIMIT = "pdf_cache_limit_bytes"
        private const val KEY_GLASS_MODE = "liquid_glass_mode"
        private const val KEY_DOWNLOAD_HISTORY = "download_history_v2"
        private const val KEY_DOWNLOAD_HISTORY_LEGACY = "download_history_v1"
        private const val KEY_HANDLED_DOWNLOADS = "handled_downloads_v1"
        private const val KEY_READING_PREFIX = "reading_v1:"
        private const val KEY_INDEX_PREFIX = "mobile_index_v1:"
        private const val KEY_ROOM_MIGRATED = "room_migration_v1_complete"
        private const val DEFAULT_PDF_CACHE_LIMIT_BYTES = 512L * 1024 * 1024
        private const val MIN_PDF_CACHE_LIMIT_BYTES = 64L * 1024 * 1024
        private const val MAX_PDF_CACHE_LIMIT_BYTES = 4L * 1024 * 1024 * 1024
        private const val MAX_DOWNLOAD_HISTORY = 200
        private val WINDOWS_DRIVE = Regex("^[A-Za-z]:[/\\\\].*")
    }

    private fun <T> blocking(block: suspend () -> T): T = runBlocking(Dispatchers.IO) { block() }
}

private fun RepositoryEntity.toModel() = GitHubRepository(
    name, fullName, owner, description, isPrivate, defaultBranch, updatedAt, htmlUrl, sizeKb,
    commitSha, lastSuccessfulRefreshAt
)

private fun GitHubRepository.toEntity(saved: Boolean) = RepositoryEntity(
    fullName, name, owner, description, isPrivate, defaultBranch, updatedAt, htmlUrl, sizeKb,
    commitSha, lastSuccessfulRefreshAt.takeIf { it > 0 } ?: System.currentTimeMillis(), saved
)

private fun ReadingProgress.toEntity() = ReadingProgressEntity(
    documentId, schemaVersion, repositoryFullName, projectName, AppPreferences.normalizePath(pdfPath),
    pdfName, sha, pageIndex.coerceAtLeast(0), pageCount.coerceAtLeast(1), lastReadAt
)

private fun ReadingProgressEntity.toModel() = ReadingProgress(
    schemaVersion, repositoryFullName, projectName, pdfPath, pdfName, sha, pageIndex, pageCount, lastReadAt
)

private fun PdfBookmark.toEntity() = PdfBookmarkEntity(
    stableId, repositoryFullName, AppPreferences.normalizePath(pdfPath), pageIndex, label, createdAt
)

private fun PdfBookmarkEntity.toModel() = PdfBookmark(repositoryFullName, pdfPath, pageIndex, label, createdAt)

private fun DownloadedFile.toEntity() = DownloadHistoryEntity(
    stableId, name, contentUri, displayPath, mimeType, size, downloadedAt, kind.name,
    sourceRepository, sourcePath
)

private fun DownloadHistoryEntity.toModel() = DownloadedFile(
    name, contentUri, displayPath, mimeType, size, id, downloadedAt,
    runCatching { DownloadHistoryKind.valueOf(kind) }.getOrDefault(DownloadHistoryKind.OTHER),
    sourceRepository, sourcePath
)

private fun PersistentDownloadTask.toEntity(payload: String?) = DownloadTaskEntity(
    id, uniqueKey, name, kind.name, state.name, downloaded, total, bytesPerSecond,
    repositoryFullName, path, commitSha, blobSha, error, payload, createdAt, updatedAt
)

private fun DownloadTaskEntity.toModel() = PersistentDownloadTask(
    id = id,
    uniqueKey = uniqueKey,
    name = name,
    kind = runCatching { PersistentDownloadKind.valueOf(kind) }.getOrDefault(PersistentDownloadKind.FILE),
    state = runCatching { PersistentDownloadState.valueOf(state) }.getOrDefault(PersistentDownloadState.FAILED),
    downloaded = downloaded,
    total = total,
    bytesPerSecond = bytesPerSecond,
    repositoryFullName = repositoryFullName,
    path = path,
    commitSha = commitSha,
    blobSha = blobSha,
    error = error,
    createdAt = createdAt,
    updatedAt = updatedAt
)

private fun JSONObject.optionalString(key: String): String? = optString(key)
    .takeIf { it.isNotBlank() && it != "null" }
