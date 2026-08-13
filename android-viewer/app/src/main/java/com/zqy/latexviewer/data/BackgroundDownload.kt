package com.zqy.latexviewer.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.zqy.latexviewer.MainActivity
import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.PersistentDownloadKind
import com.zqy.latexviewer.model.PersistentDownloadState
import com.zqy.latexviewer.model.PersistentDownloadTask
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import org.json.JSONObject
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit

enum class BackgroundDownloadKind {
    PUBLIC_FILE,
    REPOSITORY_ARCHIVE,
    PDF_PREVIEW,
    APP_UPDATE
}

data class BackgroundDownloadTask(
    val kind: BackgroundDownloadKind,
    val label: String,
    val name: String,
    val mimeType: String,
    val createdAt: Long = System.currentTimeMillis(),
    val owner: String? = null,
    val repository: String? = null,
    val isPrivate: Boolean = false,
    val branch: String? = null,
    val path: String? = null,
    val sha: String? = null,
    val commitSha: String? = null,
    val lfsOidSha256: String? = null,
    val contentSha256: String? = null,
    val size: Long = -1,
    val downloadUrl: String? = null,
    val cacheKey: String? = null,
    val cacheLimitBytes: Long = 512L * 1024 * 1024,
    val releaseVersion: String? = null,
    val releaseTag: String? = null,
    val releaseUrl: String? = null,
    val assetApiUrl: String? = null,
    val assetDownloadUrl: String? = null,
    val assetSha256: String? = null,
    val assetManifestVerified: Boolean = false,
    val assetCertificateSha256: String? = null
) {
    val repositoryFullName: String?
        get() = if (owner.isNullOrBlank() || repository.isNullOrBlank()) null else "$owner/$repository"

    companion object {
        fun fromJson(raw: String?): BackgroundDownloadTask? = raw
            ?.takeIf { it.isNotBlank() }
            ?.let { payload ->
                runCatching {
                    val value = JSONObject(payload)
                    BackgroundDownloadTask(
                        kind = BackgroundDownloadKind.valueOf(value.getString("kind")),
                        label = value.getString("label"),
                        name = value.getString("name"),
                        mimeType = value.getString("mimeType"),
                        createdAt = value.optLong("createdAt", System.currentTimeMillis()),
                        owner = value.optionalString("owner"),
                        repository = value.optionalString("repository"),
                        isPrivate = value.optBoolean("isPrivate", false),
                        branch = value.optionalString("branch"),
                        path = value.optionalString("path"),
                        sha = value.optionalString("sha"),
                        commitSha = value.optionalString("commitSha"),
                        lfsOidSha256 = value.optionalString("lfsOidSha256"),
                        contentSha256 = value.optionalString("contentSha256"),
                        size = value.optLong("size", -1),
                        downloadUrl = value.optionalString("downloadUrl"),
                        cacheKey = value.optionalString("cacheKey"),
                        cacheLimitBytes = value.optLong("cacheLimitBytes", 512L * 1024 * 1024),
                        releaseVersion = value.optionalString("releaseVersion"),
                        releaseTag = value.optionalString("releaseTag"),
                        releaseUrl = value.optionalString("releaseUrl"),
                        assetApiUrl = value.optionalString("assetApiUrl"),
                        assetDownloadUrl = value.optionalString("assetDownloadUrl"),
                        assetSha256 = value.optionalString("assetSha256"),
                        assetManifestVerified = value.optBoolean("assetManifestVerified", false),
                        assetCertificateSha256 = value.optionalString("assetCertificateSha256")
                    )
                }.getOrNull()
            }
    }
}

data class BackgroundDownloadSnapshot(
    val workId: UUID,
    val task: BackgroundDownloadTask,
    val state: WorkInfo.State,
    val downloaded: Long,
    val total: Long,
    val output: Data,
    val error: String?
)

class BackgroundDownloadManager(context: Context) {
    private val appContext = context.applicationContext
    private val workManager = WorkManager.getInstance(appContext)
    private val preferences = AppPreferences(appContext)
    private val enqueueLock = Any()

    val snapshots: Flow<List<BackgroundDownloadSnapshot>> = workManager
        .getWorkInfosByTagFlow(DOWNLOAD_TAG)
        .map { workInfos ->
            workInfos.mapNotNull(::snapshotOf).sortedByDescending { it.task.createdAt }
        }
        .onEach { values ->
            values.forEach { snapshot ->
                val previous = preferences.downloadTask(snapshot.workId.toString())?.first
                val persistentState = persistentStateFor(snapshot.state, previous?.state)
                preferences.saveDownloadTask(
                    snapshot.task.toPersistent(
                        snapshot.workId.toString(),
                        persistentState,
                        mergeDownloadedBytes(previous?.downloaded ?: 0L, snapshot.downloaded),
                        mergeDownloadTotal(previous?.total ?: -1L, snapshot.total),
                        snapshot.error ?: previous?.error
                    ),
                    snapshot.task.toJson().toString()
                )
            }
        }

    val persistentTasks: Flow<List<PersistentDownloadTask>> =
        ViewerDatabase.get(appContext).viewerDao().observeDownloadTasks().map { values ->
            values.map(DownloadTaskEntity::toPersistentModel)
        }

    fun enqueueFile(
        repository: GitHubRepository,
        item: GitHubContent,
        mimeType: String
    ): UUID = enqueue(
        BackgroundDownloadTask(
            kind = BackgroundDownloadKind.PUBLIC_FILE,
            label = "正在下载 ${item.name}",
            name = item.name,
            mimeType = mimeType,
            owner = repository.owner,
            repository = repository.name,
            isPrivate = repository.isPrivate,
            branch = repository.defaultBranch,
            path = item.path,
            sha = item.sha,
            commitSha = item.commitSha ?: repository.commitSha,
            lfsOidSha256 = item.lfsOidSha256,
            contentSha256 = item.contentSha256,
            size = item.size,
            downloadUrl = item.downloadUrl
        )
    )

    fun enqueueRepository(repository: GitHubRepository): UUID = enqueue(
        BackgroundDownloadTask(
            kind = BackgroundDownloadKind.REPOSITORY_ARCHIVE,
            label = "正在下载 ${repository.name}",
            name = "${repository.name}-${repository.defaultBranch}.zip",
            mimeType = "application/zip",
            owner = repository.owner,
            repository = repository.name,
            isPrivate = repository.isPrivate,
            branch = repository.defaultBranch,
            commitSha = repository.commitSha
        )
    )

    fun enqueuePdf(
        repository: GitHubRepository,
        item: GitHubContent,
        displayName: String,
        cacheLimitBytes: Long
    ): UUID = enqueue(
        BackgroundDownloadTask(
            kind = BackgroundDownloadKind.PDF_PREVIEW,
            label = "正在下载 $displayName",
            name = displayName.ifBlank { item.name },
            mimeType = "application/pdf",
            owner = repository.owner,
            repository = repository.name,
            isPrivate = repository.isPrivate,
            branch = repository.defaultBranch,
            path = item.path,
            sha = item.sha,
            commitSha = item.commitSha ?: repository.commitSha,
            lfsOidSha256 = item.lfsOidSha256,
            contentSha256 = item.contentSha256,
            size = item.size,
            downloadUrl = item.downloadUrl,
            cacheKey = "${repository.owner}-${repository.name}-${item.sha}.pdf",
            cacheLimitBytes = cacheLimitBytes
        )
    )

    fun enqueueUpdate(asset: AndroidReleaseAsset): UUID = enqueue(
        BackgroundDownloadTask(
            kind = BackgroundDownloadKind.APP_UPDATE,
            label = "正在下载 Android ${asset.version}",
            name = asset.name,
            mimeType = "application/vnd.android.package-archive",
            size = asset.size,
            releaseVersion = asset.version,
            releaseTag = asset.releaseTag,
            releaseUrl = asset.releaseUrl,
            assetApiUrl = asset.apiUrl,
            assetDownloadUrl = asset.downloadUrl,
            assetSha256 = asset.sha256,
            assetManifestVerified = asset.manifestVerified,
            assetCertificateSha256 = asset.certificateSha256
        )
    )

    fun cancel(workId: UUID) {
        // Persist explicit user intent before WorkManager stops the coroutine.
        // Constraint/process stops must not be mistaken for a user cancellation.
        val stored = preferences.downloadTask(workId.toString())
        stored?.first?.let { current ->
            preferences.updateDownloadTask(
                current.copy(
                    state = PersistentDownloadState.CANCELLED,
                    error = "已取消",
                    updatedAt = System.currentTimeMillis()
                )
            )
        }
        val store = DownloadStore(appContext)
        val task = BackgroundDownloadTask.fromJson(stored?.second)
        if (task != null) {
            store.discardResumableStaging(task.uniqueIdentity(), workId.toString())
        } else {
            store.discardStaging(store.stagingFile(workId.toString()))
        }
        workManager.cancelWorkById(workId)
    }

    fun retry(workId: String): UUID? {
        val (_, payload) = preferences.downloadTask(workId) ?: return null
        val task = BackgroundDownloadTask.fromJson(payload) ?: return null
        DownloadStore(appContext).resumableStagingFile(task.uniqueIdentity(), workId)
        return enqueue(task.copy(createdAt = System.currentTimeMillis()))
    }

    private fun enqueue(task: BackgroundDownloadTask): UUID = synchronized(enqueueLock) {
        val uniqueKey = task.uniqueIdentity()
        val existingId = preferences.activeDownloadTask(uniqueKey)?.first?.id
        if (existingId != null) {
            runCatching { UUID.fromString(existingId) }.getOrNull()?.let { return@synchronized it }
        }
        val payload = task.toJson().toString()
        val request = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(workDataOf(KEY_TASK to payload))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .addTag(DOWNLOAD_TAG)
            .addTag(metadataTag(payload))
            .build()
        val resumedBytes = DownloadStore(appContext)
            .resumableStagingFile(uniqueKey)
            .takeIf { it.isFile }
            ?.length()
            ?: 0L
        preferences.saveDownloadTask(
            task.toPersistent(
                request.id.toString(),
                PersistentDownloadState.QUEUED,
                downloaded = resumedBytes,
                total = task.size
            ),
            payload
        )
        workManager.enqueueUniqueWork(
            task.uniqueWorkName(),
            ExistingWorkPolicy.KEEP,
            request
        )
        return request.id
    }

    private fun snapshotOf(info: WorkInfo): BackgroundDownloadSnapshot? {
        val encoded = info.tags.firstOrNull { it.startsWith(METADATA_TAG_PREFIX) }
            ?.removePrefix(METADATA_TAG_PREFIX)
            ?: return null
        val payload = runCatching {
            String(Base64.getUrlDecoder().decode(encoded), Charsets.UTF_8)
        }.getOrNull() ?: return null
        val task = BackgroundDownloadTask.fromJson(payload) ?: return null
        val persisted = preferences.downloadTask(info.id.toString())?.first
        return BackgroundDownloadSnapshot(
            workId = info.id,
            task = task,
            state = info.state,
            downloaded = mergeDownloadedBytes(
                persisted?.downloaded ?: 0L,
                info.progress.getLong(KEY_DOWNLOADED, 0L)
            ),
            total = mergeDownloadTotal(
                persisted?.total ?: -1L,
                info.progress.getLong(KEY_TOTAL, task.size)
            ),
            output = info.outputData,
            error = info.outputData.getString(KEY_ERROR)
        )
    }

    private fun metadataTag(payload: String): String = METADATA_TAG_PREFIX +
        Base64.getUrlEncoder().withoutPadding().encodeToString(payload.toByteArray(Charsets.UTF_8))

    companion object {
        const val DOWNLOAD_TAG = "latex-background-download"
        const val KEY_TASK = "task"
        const val KEY_DOWNLOADED = "downloaded"
        const val KEY_TOTAL = "total"
        const val KEY_ERROR = "error"
        const val KEY_OUTPUT_NAME = "output_name"
        const val KEY_OUTPUT_URI = "output_uri"
        const val KEY_OUTPUT_PATH = "output_path"
        const val KEY_OUTPUT_MIME = "output_mime"
        const val KEY_OUTPUT_SIZE = "output_size"
        private const val METADATA_TAG_PREFIX = "latex-download-meta:"
    }
}

class DownloadWorker(
    appContext: Context,
    parameters: WorkerParameters
) : CoroutineWorker(appContext, parameters) {
    private val notificationManager = appContext.getSystemService(NotificationManager::class.java)

    override suspend fun doWork(): Result {
        val task = BackgroundDownloadTask.fromJson(inputData.getString(BackgroundDownloadManager.KEY_TASK))
            ?: return Result.failure(workDataOf(BackgroundDownloadManager.KEY_ERROR to "下载任务信息已损坏"))
        val expectedTotal = task.size.takeIf { it > 0 } ?: -1L
        val preferences = AppPreferences(applicationContext)
        val store = DownloadStore(applicationContext)
        val staging = store.resumableStagingFile(task.uniqueIdentity(), id.toString())
        val resumedBytes = staging.takeIf { it.isFile }?.length() ?: 0L
        preferences.saveDownloadTask(
            task.toPersistent(
                id.toString(),
                PersistentDownloadState.RUNNING,
                downloaded = resumedBytes,
                total = expectedTotal
            ),
            task.toJson().toString()
        )
        createNotificationChannel()
        setForeground(foregroundInfo(task, resumedBytes, expectedTotal))
        publishProgress(task, resumedBytes, expectedTotal, force = true)

        return try {
            val api = GitHubApi()
            val token = SecureTokenStore(applicationContext).read()
            var lastPublishAt = 0L
            val onProgress: (Long, Long) -> Unit = { downloaded, total ->
                val now = System.currentTimeMillis()
                if (now - lastPublishAt >= PROGRESS_INTERVAL_MS || (total > 0 && downloaded >= total)) {
                    publishProgress(task, downloaded, total, force = true)
                    lastPublishAt = now
                }
            }
            val output = when (task.kind) {
                BackgroundDownloadKind.PUBLIC_FILE -> {
                    val repository = task.repositoryModel()
                    val item = task.contentModel()
                    api.downloadFile(repository, item, token, staging, onProgress)
                    val file = store.publishPublicDownloadFromFile(task.name, task.mimeType, staging)
                    downloadedFileOutput(file)
                }
                BackgroundDownloadKind.REPOSITORY_ARCHIVE -> {
                    api.downloadRepositoryArchive(task.repositoryModel(), token, staging, onProgress)
                    val file = store.publishPublicDownloadFromFile(task.name, task.mimeType, staging)
                    downloadedFileOutput(file)
                }
                BackgroundDownloadKind.PDF_PREVIEW -> {
                    api.downloadFile(task.repositoryModel(), task.contentModel(), token, staging, onProgress)
                    val file = store.commitPdfPreviewFromFile(
                        task.cacheKey ?: error("PDF 缓存键缺失"),
                        task.cacheLimitBytes,
                        staging
                    )
                    workDataOf(
                        BackgroundDownloadManager.KEY_OUTPUT_NAME to task.name,
                        BackgroundDownloadManager.KEY_OUTPUT_PATH to file.absolutePath,
                        BackgroundDownloadManager.KEY_OUTPUT_MIME to task.mimeType,
                        BackgroundDownloadManager.KEY_OUTPUT_SIZE to file.length()
                    )
                }
                BackgroundDownloadKind.APP_UPDATE -> {
                    val asset = task.releaseAsset()
                    require(asset.manifestVerified && !asset.sha256.isNullOrBlank()) {
                        "更新缺少有效签名发布清单，已拒绝下载"
                    }
                    api.downloadAndroidUpdate(asset, staging, onProgress)
                    val expected = VerifiedAndroidReleaseAsset(
                        asset.version,
                        asset.name,
                        asset.size,
                        asset.sha256,
                        asset.certificateSha256
                    )
                    val file = store.commitUpdateFromFile(asset, staging) { candidate ->
                        ReleaseSecurity.verifyDownloadedApk(applicationContext, candidate, expected)
                    }
                    workDataOf(
                        BackgroundDownloadManager.KEY_OUTPUT_NAME to task.name,
                        BackgroundDownloadManager.KEY_OUTPUT_PATH to file.absolutePath,
                        BackgroundDownloadManager.KEY_OUTPUT_MIME to task.mimeType,
                        BackgroundDownloadManager.KEY_OUTPUT_SIZE to file.length()
                    )
                }
            }
            notifyCompleted(task)
            preferences.saveDownloadTask(
                task.toPersistent(
                    id.toString(),
                    PersistentDownloadState.SUCCEEDED,
                    downloaded = output.getLong(BackgroundDownloadManager.KEY_OUTPUT_SIZE, task.size.coerceAtLeast(0)),
                    total = output.getLong(BackgroundDownloadManager.KEY_OUTPUT_SIZE, task.size)
                ),
                task.toJson().toString()
            )
            Result.success(output)
        } catch (cancelled: CancellationException) {
            // Preserve the immutable commit-bound partial. WorkManager can cancel
            // this coroutine when network constraints change or the worker is
            // stopped for rescheduling; the next attempt can safely resume it via
            // Range/If-Range. Explicit UI cancellation cleans it in cancel().
            val previous = preferences.downloadTask(id.toString())?.first
            val explicitlyCancelled = previous?.state == PersistentDownloadState.CANCELLED
            val durableBytes = staging.takeIf { it.isFile }?.length() ?: 0L
            preferences.saveDownloadTask(
                task.toPersistent(
                    id.toString(),
                    if (explicitlyCancelled) PersistentDownloadState.CANCELLED
                    else PersistentDownloadState.WAITING_FOR_NETWORK,
                    downloaded = if (explicitlyCancelled) previous.downloaded else durableBytes,
                    total = mergeDownloadTotal(previous?.total ?: -1L, expectedTotal),
                    error = if (explicitlyCancelled) "已取消" else "下载已暂停，等待系统恢复"
                ),
                task.toJson().toString()
            )
            throw cancelled
        } catch (failure: Throwable) {
            if (runAttemptCount < MAX_RETRY_ATTEMPTS && failure.isRetryableDownloadFailure()) {
                preferences.saveDownloadTask(
                    task.toPersistent(
                        id.toString(),
                        PersistentDownloadState.WAITING_FOR_NETWORK,
                        downloaded = staging.takeIf { it.isFile }?.length() ?: 0L,
                        total = expectedTotal,
                        error = failure.message
                    ),
                    task.toJson().toString()
                )
                Result.retry()
            } else {
                // Keep transient network/server partials for a user retry.
                // Integrity and security failures are never reused.
                if (!failure.isRetryableDownloadFailure()) {
                    store.discardResumableStaging(task.uniqueIdentity(), id.toString())
                }
                val durableBytes = staging.takeIf { it.isFile }?.length() ?: 0L
                preferences.saveDownloadTask(
                    task.toPersistent(
                        id.toString(),
                        PersistentDownloadState.FAILED,
                        downloaded = durableBytes,
                        total = expectedTotal,
                        error = failure.message ?: "下载失败，请稍后重试"
                    ),
                    task.toJson().toString()
                )
                Result.failure(workDataOf(
                    BackgroundDownloadManager.KEY_ERROR to (failure.message ?: "下载失败，请稍后重试")
                ))
            }
        }
    }

    private fun publishProgress(task: BackgroundDownloadTask, downloaded: Long, total: Long, force: Boolean) {
        if (!force) return
        val progress = workDataOf(
            BackgroundDownloadManager.KEY_DOWNLOADED to downloaded.coerceAtLeast(0),
            BackgroundDownloadManager.KEY_TOTAL to total
        )
        runCatching { setProgressAsync(progress) }
        runCatching {
            AppPreferences(applicationContext).saveDownloadTask(
                task.toPersistent(
                    id.toString(),
                    PersistentDownloadState.RUNNING,
                    downloaded,
                    total
                ),
                task.toJson().toString()
            )
        }
        runCatching { notificationManager.notify(notificationId, notification(task, downloaded, total, true)) }
    }

    private fun foregroundInfo(task: BackgroundDownloadTask, downloaded: Long, total: Long): ForegroundInfo {
        val notification = notification(task, downloaded, total, true)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(notificationId, notification)
        }
    }

    private fun notification(
        task: BackgroundDownloadTask,
        downloaded: Long,
        total: Long,
        ongoing: Boolean
    ): android.app.Notification {
        val openIntent = Intent(applicationContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val contentIntent = PendingIntent.getActivity(
            applicationContext,
            notificationId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(applicationContext, NOTIFICATION_CHANNEL)
            .setSmallIcon(if (ongoing) android.R.drawable.stat_sys_download else android.R.drawable.stat_sys_download_done)
            .setContentTitle(if (ongoing) task.label else "下载完成")
            .setContentText(if (ongoing) "熄屏或切换应用后仍会继续" else task.name)
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setOngoing(ongoing)
            .setAutoCancel(!ongoing)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        if (ongoing) {
            if (total > 0) {
                val percent = ((downloaded * 100L) / total).coerceIn(0, 100).toInt()
                builder.setProgress(100, percent, false).setSubText("$percent%")
            } else {
                builder.setProgress(0, 0, true)
            }
            builder.addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "取消",
                explicitCancelPendingIntent()
            )
        }
        return builder.build()
    }

    private fun notifyCompleted(task: BackgroundDownloadTask) {
        runCatching { notificationManager.notify(notificationId, notification(task, task.size, task.size, false)) }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        notificationManager.createNotificationChannel(
            NotificationChannel(
                NOTIFICATION_CHANNEL,
                "文件下载",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "显示 GitHub 项目文件和应用更新的后台下载进度"
            }
        )
    }

    private fun downloadedFileOutput(file: DownloadedFile): Data = workDataOf(
        BackgroundDownloadManager.KEY_OUTPUT_NAME to file.name,
        BackgroundDownloadManager.KEY_OUTPUT_URI to file.contentUri,
        BackgroundDownloadManager.KEY_OUTPUT_PATH to file.displayPath,
        BackgroundDownloadManager.KEY_OUTPUT_MIME to file.mimeType,
        BackgroundDownloadManager.KEY_OUTPUT_SIZE to file.size
    )

    private val notificationId: Int
        get() = (id.hashCode() and 0x0fffffff).coerceAtLeast(1000)

    private fun explicitCancelPendingIntent(): PendingIntent {
        val intent = Intent(applicationContext, DownloadCancelReceiver::class.java)
            .setAction(ACTION_CANCEL_DOWNLOAD)
            .putExtra(EXTRA_WORK_ID, id.toString())
        return PendingIntent.getBroadcast(
            applicationContext,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    companion object {
        const val NOTIFICATION_CHANNEL = "latex_downloads"
        const val PROGRESS_INTERVAL_MS = 1_000L
        const val MAX_RETRY_ATTEMPTS = 3
        const val ACTION_CANCEL_DOWNLOAD = "com.zqy.latexviewer.action.CANCEL_DOWNLOAD"
        const val EXTRA_WORK_ID = "work_id"
    }
}

/** Routes notification cancellation through the durable user-cancel path. */
class DownloadCancelReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != DownloadWorker.ACTION_CANCEL_DOWNLOAD) return
        val workId = intent.getStringExtra(DownloadWorker.EXTRA_WORK_ID)
            ?.let { runCatching { UUID.fromString(it) }.getOrNull() }
            ?: return
        BackgroundDownloadManager(context.applicationContext).cancel(workId)
    }
}

private fun BackgroundDownloadTask.repositoryModel(): GitHubRepository = GitHubRepository(
    name = repository ?: error("仓库名称缺失"),
    fullName = repositoryFullName ?: error("仓库信息缺失"),
    owner = owner ?: error("仓库所有者缺失"),
    description = null,
    isPrivate = this.isPrivate,
    defaultBranch = branch ?: "main",
    updatedAt = "",
    htmlUrl = "https://github.com/${repositoryFullName}",
    sizeKb = 0,
    commitSha = commitSha
)

private fun BackgroundDownloadTask.contentModel(): GitHubContent = GitHubContent(
    name = path?.substringAfterLast('/') ?: name,
    path = path ?: error("下载路径缺失"),
    kind = GitHubContentKind.FILE,
    size = size,
    sha = sha.orEmpty(),
    htmlUrl = repositoryFullName?.let { "https://github.com/$it/blob/${branch ?: "main"}/$path" },
    downloadUrl = downloadUrl,
    commitSha = commitSha,
    gitObjectSha = sha.orEmpty(),
    lfsOidSha256 = lfsOidSha256,
    contentSha256 = contentSha256
)

private fun BackgroundDownloadTask.releaseAsset(): AndroidReleaseAsset = AndroidReleaseAsset(
    version = releaseVersion ?: error("更新版本缺失"),
    releaseTag = releaseTag.orEmpty(),
    releaseUrl = releaseUrl.orEmpty(),
    name = name,
    apiUrl = assetApiUrl ?: error("更新下载地址缺失"),
    downloadUrl = assetDownloadUrl.orEmpty(),
    size = size,
    sha256 = assetSha256,
    manifestVerified = assetManifestVerified,
    certificateSha256 = assetCertificateSha256
)

private fun BackgroundDownloadTask.toJson(): JSONObject = JSONObject()
    .put("kind", kind.name)
    .put("label", label)
    .put("name", name)
    .put("mimeType", mimeType)
    .put("createdAt", createdAt)
    .put("owner", owner)
    .put("repository", repository)
    .put("isPrivate", isPrivate)
    .put("branch", branch)
    .put("path", path)
    .put("sha", sha)
    .put("commitSha", commitSha)
    .put("lfsOidSha256", lfsOidSha256)
    .put("contentSha256", contentSha256)
    .put("size", size)
    .put("downloadUrl", downloadUrl)
    .put("cacheKey", cacheKey)
    .put("cacheLimitBytes", cacheLimitBytes)
    .put("releaseVersion", releaseVersion)
    .put("releaseTag", releaseTag)
    .put("releaseUrl", releaseUrl)
    .put("assetApiUrl", assetApiUrl)
    .put("assetDownloadUrl", assetDownloadUrl)
    .put("assetSha256", assetSha256)
    .put("assetManifestVerified", assetManifestVerified)
    .put("assetCertificateSha256", assetCertificateSha256)

private fun BackgroundDownloadTask.uniqueIdentity(): String = when (kind) {
    BackgroundDownloadKind.PUBLIC_FILE -> "file:${repositoryFullName}:${path}:${commitSha}:${sha}"
    BackgroundDownloadKind.REPOSITORY_ARCHIVE -> "archive:${repositoryFullName}:${commitSha ?: branch}"
    BackgroundDownloadKind.PDF_PREVIEW -> "pdf:${cacheKey.orEmpty()}:${commitSha}:${sha}"
    BackgroundDownloadKind.APP_UPDATE -> "update:${releaseVersion.orEmpty()}:${assetSha256.orEmpty()}"
}

private fun BackgroundDownloadTask.uniqueWorkName(): String =
    "latex-download-${kind.name.lowercase()}-${uniqueIdentity().hashCode().toUInt().toString(16)}"

private fun BackgroundDownloadTask.toPersistent(
    id: String,
    state: PersistentDownloadState,
    downloaded: Long = 0L,
    total: Long = size,
    error: String? = null
) = PersistentDownloadTask(
    id = id,
    uniqueKey = uniqueIdentity(),
    name = name,
    kind = when (kind) {
        BackgroundDownloadKind.PUBLIC_FILE -> PersistentDownloadKind.FILE
        BackgroundDownloadKind.REPOSITORY_ARCHIVE -> PersistentDownloadKind.PROJECT_ARCHIVE
        BackgroundDownloadKind.PDF_PREVIEW -> PersistentDownloadKind.PDF_PREVIEW
        BackgroundDownloadKind.APP_UPDATE -> PersistentDownloadKind.APP_UPDATE
    },
    state = state,
    downloaded = downloaded,
    total = total,
    repositoryFullName = repositoryFullName,
    path = path,
    commitSha = commitSha,
    blobSha = sha,
    error = error,
    createdAt = createdAt,
    updatedAt = System.currentTimeMillis()
)

private fun DownloadTaskEntity.toPersistentModel() = PersistentDownloadTask(
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

private fun Throwable.isRetryableDownloadFailure(): Boolean {
    if (this is IllegalArgumentException || this is SecurityException) return false
    val detail = message.orEmpty()
    return listOf(
        "令牌无效",
        "没有读取",
        "没有找到",
        "超过 4 GB",
        "不是有效的 PDF",
        "Android 安装包签名",
        "Android 安装包证书",
        "无法读取 Android 安装包签名"
    ).none {
        detail.contains(it)
    }
}

internal fun mergeDownloadedBytes(persisted: Long, reported: Long): Long =
    maxOf(persisted.coerceAtLeast(0L), reported.coerceAtLeast(0L))

internal fun mergeDownloadTotal(persisted: Long, reported: Long): Long = when {
    persisted > 0L && reported > 0L -> maxOf(persisted, reported)
    reported > 0L -> reported
    else -> persisted
}

internal fun persistentStateFor(
    workState: WorkInfo.State,
    previous: PersistentDownloadState?
): PersistentDownloadState = when (workState) {
    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> PersistentDownloadState.WAITING_FOR_NETWORK
    WorkInfo.State.RUNNING -> PersistentDownloadState.RUNNING
    WorkInfo.State.SUCCEEDED -> PersistentDownloadState.SUCCEEDED
    WorkInfo.State.FAILED -> if (previous == PersistentDownloadState.SUCCEEDED) previous else PersistentDownloadState.FAILED
    WorkInfo.State.CANCELLED -> when (previous) {
        PersistentDownloadState.CANCELLED,
        PersistentDownloadState.SUCCEEDED -> previous
        else -> PersistentDownloadState.WAITING_FOR_NETWORK
    }
}
