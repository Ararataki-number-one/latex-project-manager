package com.zqy.latexviewer.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import com.zqy.latexviewer.data.AppPreferences
import com.zqy.latexviewer.data.BackgroundDownloadKind
import com.zqy.latexviewer.data.BackgroundDownloadManager
import com.zqy.latexviewer.data.BackgroundDownloadSnapshot
import com.zqy.latexviewer.data.BackgroundDownloadTask
import com.zqy.latexviewer.data.DownloadStore
import com.zqy.latexviewer.data.GitHubApi
import com.zqy.latexviewer.data.GitHubDeviceAuthorization
import com.zqy.latexviewer.data.GitHubDeviceTokenResult
import com.zqy.latexviewer.data.GitHubRequestException
import com.zqy.latexviewer.data.MobileIndexFetchResult
import com.zqy.latexviewer.data.SecureTokenStore
import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.DownloadHistoryKind
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.GlassMode
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import com.zqy.latexviewer.model.PdfDocument
import com.zqy.latexviewer.model.PdfBookmark
import com.zqy.latexviewer.model.PersistentDownloadTask
import com.zqy.latexviewer.model.ReadingProgress
import com.zqy.latexviewer.model.RepositoryRefreshFailure
import com.zqy.latexviewer.model.TextDocument
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

enum class ViewerScreen {
    HOME,
    CONNECT,
    REPOSITORIES,
    DOWNLOADS,
    FILES,
    TEXT,
    PDF,
    SETTINGS
}

data class TransferUiState(
    val workId: String,
    val label: String,
    val downloaded: Long = 0,
    val total: Long = -1,
    val waitingForNetwork: Boolean = false,
    val bytesPerSecond: Long = 0
)

data class ViewerUiState(
    val screen: ViewerScreen = ViewerScreen.HOME,
    val tokenStored: Boolean = false,
    val repositories: List<GitHubRepository> = emptyList(),
    val mobileIndexes: Map<String, MobileProjectIndex> = emptyMap(),
    val recentReading: ReadingProgress? = null,
    val recentReadings: List<ReadingProgress> = emptyList(),
    val repositoriesStale: Boolean = false,
    val repositoryRefreshFailures: Map<String, RepositoryRefreshFailure> = emptyMap(),
    val repositoryQuery: String = "",
    val currentRepository: GitHubRepository? = null,
    val currentPath: String = "",
    val contents: List<GitHubContent> = emptyList(),
    val fileQuery: String = "",
    val document: TextDocument? = null,
    val pdfDocument: PdfDocument? = null,
    val pdfBookmarks: List<PdfBookmark> = emptyList(),
    val completedDownload: DownloadedFile? = null,
    val completedDownloadWorkId: String? = null,
    val downloadedFiles: List<DownloadedFile> = emptyList(),
    val downloadAvailability: Map<String, Boolean> = emptyMap(),
    val externalFile: DownloadedFile? = null,
    val shareFile: DownloadedFile? = null,
    val loading: Boolean = false,
    val transfer: TransferUiState? = null,
    val downloadTasks: List<PersistentDownloadTask> = emptyList(),
    val transferPanelVisible: Boolean = true,
    val error: String? = null,
    val notice: String? = null,
    val externalUrl: String? = null,
    val currentVersion: String,
    val autoCheckUpdates: Boolean,
    val autoDownloadUpdates: Boolean,
    val updateChecking: Boolean = false,
    val updateAvailable: Boolean = false,
    val updateInfo: AndroidReleaseAsset? = null,
    val updateMessage: String = "尚未检查更新",
    val downloadedApkPath: String? = null,
    val pdfCacheBytes: Long = 0,
    val pdfCacheLimitBytes: Long = 512L * 1024 * 1024,
    val glassMode: GlassMode = GlassMode.AUTO,
    val githubLoginSupported: Boolean = false,
    val githubDeviceAuthorization: GitHubDeviceAuthorization? = null,
    val githubLoginPolling: Boolean = false
)

class ViewerViewModel(
    private val api: GitHubApi,
    private val tokenStore: SecureTokenStore,
    private val downloadStore: DownloadStore,
    private val backgroundDownloads: BackgroundDownloadManager,
    private val preferences: AppPreferences,
    private val currentVersion: String,
    private val githubClientId: String = ""
) : ViewModel() {
    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<ViewerUiState> = _state.asStateFlow()
    private var settingsReturnScreen = ViewerScreen.HOME
    private var viewerReturnScreen = ViewerScreen.HOME
    private var pendingPdfOpenKey: String? = null
    private val seenFinishedDownloads = mutableSetOf<String>()
    private val transferSamples = mutableMapOf<String, Pair<Long, Long>>()

    init {
        observeBackgroundDownloads()
        observePersistentDownloads()
        loadRepositories()
        refreshCacheUsage()
        refreshDownloadHistoryAvailability()
        if (_state.value.autoCheckUpdates) checkForUpdates(silent = true)
    }

    fun connect(token: String, quickRepository: String) {
        val normalizedToken = token.trim()
        val normalizedRepository = quickRepository.trim()
        if (normalizedToken.isEmpty() && !tokenStore.hasToken() && normalizedRepository.isEmpty()) {
            showError("请输入 GitHub 仓库地址")
            return
        }
        launchRequest {
            val effectiveToken = if (normalizedToken.isNotEmpty()) {
                // Never persist an unverified credential.
                api.validateToken(normalizedToken)
                tokenStore.save(normalizedToken)
                normalizedToken
            } else tokenStore.read()
            _state.update { it.copy(tokenStored = tokenStore.hasToken(), error = null) }
            if (normalizedRepository.isNotEmpty()) {
                val remote = api.getRepository(normalizedRepository, effectiveToken)
                val commit = api.resolveCommit(remote, effectiveToken, forceRefresh = true)
                val repository = remote.copy(
                    commitSha = commit.commitSha,
                    lastSuccessfulRefreshAt = System.currentTimeMillis()
                )
                rememberRepository(repository)
                openRepositoryContents(repository, "")
            } else {
                refreshRepositories(effectiveToken, preferences.savedRepositoryReferences())
            }
        }
    }

    fun openAddProject() {
        pendingPdfOpenKey = null
        _state.update { it.copy(screen = ViewerScreen.CONNECT, error = null) }
    }

    fun openHome() {
        pendingPdfOpenKey = null
        _state.update { it.copy(screen = ViewerScreen.HOME, currentRepository = null, currentPath = "", error = null) }
    }

    fun openProjects() {
        pendingPdfOpenKey = null
        _state.update { it.copy(screen = ViewerScreen.REPOSITORIES, currentRepository = null, currentPath = "", error = null) }
    }

    fun openDownloads() {
        pendingPdfOpenKey = null
        _state.value.completedDownloadWorkId?.let(preferences::markDownloadWorkHandled)
        _state.update {
            it.copy(
                screen = ViewerScreen.DOWNLOADS,
                currentRepository = null,
                currentPath = "",
                completedDownload = null,
                completedDownloadWorkId = null,
                error = null
            )
        }
        refreshDownloadHistoryAvailability()
    }

    fun loadRepositories() {
        val token = tokenStore.read()
        val savedReferences = preferences.savedRepositoryReferences()
        val cached = preferences.repositorySnapshots()
        if (cached.isNotEmpty()) {
            _state.update {
                it.copy(
                    repositories = cached,
                    mobileIndexes = preferences.cachedMobileIndexes(),
                    recentReading = preferences.mostRecentReading(),
                    recentReadings = preferences.allReadingProgress(),
                    repositoriesStale = true,
                    tokenStored = tokenStore.hasToken()
                )
            }
        }
        if (savedReferences.isEmpty() && token.isNullOrBlank()) {
            _state.update {
                it.copy(
                    screen = rootScreenAfterRepositoryRefresh(it.screen),
                    repositories = cached,
                    mobileIndexes = preferences.cachedMobileIndexes(),
                    tokenStored = false,
                    repositoriesStale = false,
                    loading = false,
                    currentRepository = null,
                    currentPath = "",
                    contents = emptyList(),
                    document = null,
                    pdfDocument = null
                )
            }
            return
        }
        launchRequest {
            refreshRepositories(token, savedReferences)
        }
    }

    fun startGitHubLogin() {
        if (githubClientId.isBlank()) {
            showError("此安装包尚未配置 GitHub 登录，可先添加公开项目或使用高级令牌")
            return
        }
        launchRequest {
            val authorization = api.startDeviceFlow(githubClientId)
            _state.update { it.copy(githubDeviceAuthorization = authorization, githubLoginPolling = true) }
            pollGitHubLogin(authorization)
        }
    }

    fun cancelGitHubLogin() {
        _state.update { it.copy(githubDeviceAuthorization = null, githubLoginPolling = false) }
    }

    private suspend fun pollGitHubLogin(authorization: GitHubDeviceAuthorization) {
        val deadline = System.currentTimeMillis() + authorization.expiresInSeconds * 1_000L
        var intervalSeconds = authorization.intervalSeconds
        while (_state.value.githubLoginPolling && System.currentTimeMillis() < deadline) {
            delay(intervalSeconds * 1_000L)
            when (val result = api.pollDeviceFlow(githubClientId, authorization.deviceCode)) {
                is GitHubDeviceTokenResult.Authorized -> {
                    api.validateToken(result.token)
                    tokenStore.save(result.token)
                    _state.update {
                        it.copy(
                            tokenStored = true,
                            githubDeviceAuthorization = null,
                            githubLoginPolling = false
                        )
                    }
                    showNotice("GitHub 登录成功")
                    refreshRepositories(result.token, preferences.savedRepositoryReferences())
                    return
                }
                GitHubDeviceTokenResult.Pending -> Unit
                GitHubDeviceTokenResult.SlowDown -> intervalSeconds += 5
                GitHubDeviceTokenResult.Expired -> {
                    showError("GitHub 登录码已过期，请重新开始")
                    cancelGitHubLogin()
                    return
                }
                GitHubDeviceTokenResult.Denied -> {
                    showError("你已取消 GitHub 授权")
                    cancelGitHubLogin()
                    return
                }
                is GitHubDeviceTokenResult.Failed -> {
                    showError(result.message)
                    cancelGitHubLogin()
                    return
                }
            }
        }
        if (_state.value.githubLoginPolling) {
            showError("GitHub 登录码已过期，请重新开始")
            cancelGitHubLogin()
        }
    }

    private suspend fun refreshRepositories(token: String?, savedReferences: List<String>) {
        val cached = preferences.repositorySnapshots().associateBy { it.fullName.lowercase() }
        val failures = linkedMapOf<String, RepositoryRefreshFailure>()
        val repositories = if (savedReferences.isNotEmpty()) {
            coroutineScope {
                savedReferences.map { reference ->
                    async {
                        try {
                            val remote = api.getRepository(reference, token)
                            val commit = api.resolveCommit(remote, token, forceRefresh = true)
                            remote.copy(
                                commitSha = commit.commitSha,
                                lastSuccessfulRefreshAt = System.currentTimeMillis()
                            ).also(preferences::saveRepositorySnapshot)
                        } catch (failure: Throwable) {
                            synchronized(failures) {
                                failures[reference.lowercase()] = failure.toRefreshFailure()
                            }
                            cached[reference.lowercase()]
                        }
                    }
                }.awaitAll().filterNotNull()
            }
        } else {
            api.listRepositories(token.orEmpty()).onEach(preferences::saveRepositorySnapshot)
        }
        val sorted = repositories.distinctBy { it.fullName.lowercase() }
            .sortedByDescending(GitHubRepository::updatedAt)
        _state.update {
            it.copy(
                screen = rootScreenAfterRepositoryRefresh(it.screen),
                repositories = sorted,
                tokenStored = tokenStore.hasToken(),
                repositoriesStale = failures.isNotEmpty(),
                repositoryRefreshFailures = failures,
                currentRepository = null,
                currentPath = "",
                contents = emptyList(),
                document = null,
                pdfDocument = null
            )
        }
        refreshMobileIndexes(sorted)
        if (failures.isNotEmpty()) showNotice("${failures.size} 个项目正在显示上次成功保存的内容")
    }

    fun openRepositoryReference(reference: String) {
        pendingPdfOpenKey = null
        launchRequest {
            val token = tokenStore.read()
            val remote = api.getRepository(reference, token)
            val commit = api.resolveCommit(remote, token, forceRefresh = true)
            val repository = remote.copy(commitSha = commit.commitSha, lastSuccessfulRefreshAt = System.currentTimeMillis())
            rememberRepository(repository)
            openRepositoryContents(repository, "")
        }
    }

    fun openRepository(repository: GitHubRepository) {
        pendingPdfOpenKey = null
        rememberRepository(repository)
        launchRequest {
            val commit = api.resolveCommit(repository, tokenStore.read(), forceRefresh = true)
            val pinned = repository.copy(commitSha = commit.commitSha, lastSuccessfulRefreshAt = System.currentTimeMillis())
            rememberRepository(pinned)
            openRepositoryContents(pinned, "")
        }
    }

    fun openMobilePdf(repository: GitHubRepository, output: MobilePdfOutput) {
        pendingPdfOpenKey = pdfOpenKey(repository.fullName, output.pdfPath)
        if (_state.value.screen != ViewerScreen.PDF) viewerReturnScreen = _state.value.screen
        val previous = preferences.readingProgress(repository.fullName, output.pdfPath)
        viewModelScope.launch {
            val cached = previous?.let {
                downloadStore.findPdfPreview("${repository.owner}-${repository.name}-${it.sha}.pdf")
            }
            if (cached != null && previous != null) {
                _state.update {
                    it.copy(
                        screen = ViewerScreen.PDF,
                        document = null,
                        pdfDocument = PdfDocument(
                            name = output.name,
                            path = output.pdfPath,
                            htmlUrl = null,
                            localPath = cached.absolutePath,
                            repositoryFullName = repository.fullName,
                            sha = previous.sha,
                            commitSha = repository.commitSha,
                            blobSha = previous.sha,
                            initialPage = previous.pageIndex.coerceAtLeast(0)
                        ),
                        pdfBookmarks = preferences.bookmarks(repository.fullName, output.pdfPath)
                    )
                }
                showNotice("已打开离线缓存，正在后台检查最新版")
                runCatching {
                    val (pinned, latest) = resolveMobilePdfAtIndexCommit(repository, output)
                    if (latest.sha != previous.sha) {
                        openOrQueuePdfLatest(pinned, latest, output.name)
                        showNotice("发现新版本，正在后台更新 ${output.name}")
                    } else {
                        pendingPdfOpenKey = null
                    }
                }.onFailure {
                    pendingPdfOpenKey = null
                    showNotice("当前离线阅读；联网后可检查最新版")
                }
            } else {
                launchRequest {
                    val (pinned, latest) = resolveMobilePdfAtIndexCommit(repository, output)
                    openOrQueuePdfLatest(pinned, latest, output.name)
                }
            }
        }
    }

    fun removeRepository(repository: GitHubRepository) {
        preferences.removeRepository(repository.fullName)
        _state.update { state ->
            state.copy(
                repositories = state.repositories.filterNot {
                    it.fullName.equals(repository.fullName, ignoreCase = true)
                },
                mobileIndexes = state.mobileIndexes - repository.fullName.lowercase(),
                currentRepository = state.currentRepository?.takeUnless {
                    it.fullName.equals(repository.fullName, ignoreCase = true)
                }
            )
        }
        showNotice("${repository.name} 已从手机项目库移除，GitHub 仓库没有变化")
    }

    fun openContent(item: GitHubContent) {
        val repository = _state.value.currentRepository ?: return
        if (item.kind == GitHubContentKind.FILE) viewerReturnScreen = ViewerScreen.FILES
        when (item.kind) {
            GitHubContentKind.DIRECTORY -> launchRequest { openRepositoryContents(repository, item.path) }
            GitHubContentKind.FILE -> when {
                isPdfFile(item.name) -> openPdf(repository, item)
                api.isInlineText(item.name) && item.size <= MAX_INLINE_BYTES -> launchRequest {
                    val content = api.readTextFile(repository, item, tokenStore.read())
                    _state.update {
                        it.copy(
                            screen = ViewerScreen.TEXT,
                            document = TextDocument(item.name, item.path, content, item.htmlUrl),
                            pdfDocument = null
                        )
                    }
                }
                else -> _state.update { it.copy(externalUrl = item.htmlUrl ?: repository.htmlUrl) }
            }
            else -> _state.update { it.copy(externalUrl = item.htmlUrl ?: repository.htmlUrl) }
        }
    }

    fun downloadFile(item: GitHubContent) {
        val repository = _state.value.currentRepository ?: return
        if (item.kind != GitHubContentKind.FILE) return
        launchRequest {
            val latest = api.getContent(repository, item.path, tokenStore.read())
            backgroundDownloads.enqueueFile(repository, latest, mimeTypeFor(latest.name))
            showNotice("${latest.name} 已加入后台下载，息屏后仍会继续")
        }
    }

    fun downloadRepository(repository: GitHubRepository) {
        backgroundDownloads.enqueueRepository(repository)
        showNotice("${repository.name} 已加入后台下载，息屏后仍会继续")
    }

    fun dismissCompletedDownload() {
        _state.value.completedDownloadWorkId?.let(preferences::markDownloadWorkHandled)
        _state.update { it.copy(completedDownload = null, completedDownloadWorkId = null) }
    }

    fun openCompletedDownload() {
        val downloaded = _state.value.completedDownload ?: return
        _state.value.completedDownloadWorkId?.let(preferences::markDownloadWorkHandled)
        _state.update { it.copy(completedDownload = null, completedDownloadWorkId = null) }
        openDownloaded(downloaded)
    }

    fun openDownloaded(downloaded: DownloadedFile) {
        if (_state.value.downloadAvailability[downloaded.stableId] == false) {
            showError("文件已被移动、删除或缓存已清理，可以移除这条历史记录后重新下载")
            return
        }
        viewerReturnScreen = _state.value.screen
        when {
            isPdfFile(downloaded.name) -> launchRequest {
                val local = downloadStore.materializePdfForViewer(downloaded, preferences.pdfCacheLimitBytes)
                _state.update {
                    it.copy(
                        screen = ViewerScreen.PDF,
                        document = null,
                        pdfDocument = PdfDocument(
                            name = downloaded.name,
                            path = downloaded.displayPath,
                            htmlUrl = null,
                            localPath = local.absolutePath,
                            contentUri = downloaded.contentUri
                        )
                    )
                }
                refreshCacheUsage()
            }
            api.isInlineText(downloaded.name) && downloaded.size <= MAX_INLINE_BYTES -> launchRequest {
                val content = downloadStore.readDownloadedText(downloaded, MAX_INLINE_BYTES.toInt())
                _state.update {
                    it.copy(
                        screen = ViewerScreen.TEXT,
                        document = TextDocument(downloaded.name, downloaded.displayPath, content, null),
                        pdfDocument = null
                    )
                }
            }
            else -> _state.update { it.copy(externalFile = downloaded) }
        }
    }

    private fun recordDownload(downloaded: DownloadedFile, workId: String, announce: Boolean = true) {
        val historyItem = downloaded.copy(
            id = workId,
            downloadedAt = System.currentTimeMillis()
        )
        preferences.saveDownloadedFile(historyItem)
        _state.update {
            it.copy(
                completedDownload = if (announce) it.completedDownload ?: historyItem else it.completedDownload,
                completedDownloadWorkId = if (announce) it.completedDownloadWorkId ?: workId else it.completedDownloadWorkId,
                downloadedFiles = preferences.downloadedFiles(),
                downloadAvailability = it.downloadAvailability + (historyItem.stableId to true)
            )
        }
    }

    fun consumeExternalFile() {
        _state.update { it.copy(externalFile = null) }
    }

    fun shareDownloaded(downloaded: DownloadedFile) {
        viewModelScope.launch {
            if (!downloadStore.isDownloadedFileAvailable(downloaded)) {
                _state.update {
                    it.copy(downloadAvailability = it.downloadAvailability + (downloaded.stableId to false))
                }
                showError("文件已被移动、删除或缓存已清理，无法分享")
                return@launch
            }
            _state.update { it.copy(shareFile = downloaded) }
        }
    }

    fun consumeShareFile() {
        _state.update { it.copy(shareFile = null) }
    }

    fun removeDownloadRecord(downloaded: DownloadedFile) {
        preferences.removeDownloadedFile(downloaded.stableId)
        _state.update {
            val removingCompletion = it.completedDownload?.stableId == downloaded.stableId
            it.copy(
                downloadedFiles = preferences.downloadedFiles(),
                downloadAvailability = it.downloadAvailability - downloaded.stableId,
                completedDownload = it.completedDownload?.takeUnless { item -> item.stableId == downloaded.stableId },
                completedDownloadWorkId = if (removingCompletion) null else it.completedDownloadWorkId
            )
        }
        showNotice("已移除下载记录，手机中的文件仍然保留")
    }

    fun clearDownloadHistory() {
        preferences.clearDownloadHistory()
        _state.update {
            it.copy(
                downloadedFiles = emptyList(),
                downloadAvailability = emptyMap(),
                completedDownload = null,
                completedDownloadWorkId = null
            )
        }
        showNotice("下载历史已清空，手机中的文件仍然保留")
    }

    fun openCurrentPdfExternally() {
        val document = _state.value.pdfDocument ?: return
        val localPath = document.localPath ?: return
        runCatching { downloadStore.cachedPdfAsDownloadedFile(localPath, document.name) }
            .onSuccess { file -> _state.update { it.copy(externalFile = file) } }
            .onFailure { showError(it.message ?: "无法交给其他 PDF 应用打开") }
    }

    fun retryCurrentPdf() {
        val document = _state.value.pdfDocument ?: return
        val repository = document.repositoryFullName?.let { fullName ->
            _state.value.repositories.firstOrNull { it.fullName.equals(fullName, ignoreCase = true) }
                ?: _state.value.currentRepository?.takeIf { it.fullName.equals(fullName, ignoreCase = true) }
        }
        if (repository != null) {
            pendingPdfOpenKey = pdfOpenKey(repository.fullName, document.path)
            viewModelScope.launch {
                runCatching {
                    downloadStore.deleteCachedPdf(document.localPath)
                    val latest = api.getContent(repository, document.path, tokenStore.read())
                    backgroundDownloads.enqueuePdf(repository, latest, document.name, preferences.pdfCacheLimitBytes)
                    showNotice("正在重新下载 ${document.name}，可以隐藏进度并继续使用应用")
                }.onFailure { showError(it.message ?: "无法重新下载 PDF") }
            }
            return
        }

        val sourceUri = document.contentUri
        if (sourceUri.isNullOrBlank()) {
            showError("这个 PDF 没有可用的重新下载来源，请尝试使用其他 PDF 应用打开")
            return
        }
        viewModelScope.launch {
            val previousSize = document.localPath?.let { File(it).takeIf(File::isFile)?.length() } ?: 0L
            runCatching {
                downloadStore.deleteCachedPdf(document.localPath)
                val local = downloadStore.materializePdfForViewer(
                    DownloadedFile(document.name, sourceUri, document.path, "application/pdf", previousSize),
                    preferences.pdfCacheLimitBytes
                )
                _state.update {
                    it.copy(pdfDocument = document.copy(localPath = local.absolutePath, openedAt = System.nanoTime()))
                }
            }.onFailure { showError(it.message ?: "无法重新读取已下载的 PDF") }
        }
    }

    fun openSettings() {
        val current = _state.value.screen
        if (current == ViewerScreen.SETTINGS) return
        pendingPdfOpenKey = null
        settingsReturnScreen = current
        _state.update { it.copy(screen = ViewerScreen.SETTINGS, error = null) }
    }

    fun setAutoCheckUpdates(enabled: Boolean) {
        preferences.autoCheckUpdates = enabled
        _state.update { it.copy(autoCheckUpdates = enabled) }
        if (enabled) checkForUpdates(silent = true)
    }

    fun setAutoDownloadUpdates(enabled: Boolean) {
        preferences.autoDownloadUpdates = enabled
        _state.update { it.copy(autoDownloadUpdates = enabled) }
        if (enabled && _state.value.updateAvailable && _state.value.downloadedApkPath == null) {
            downloadUpdate()
        }
    }

    fun clearPdfCache() {
        viewModelScope.launch {
            runCatching { downloadStore.clearPdfCache() }
                .onSuccess { removed ->
                    _state.update { it.copy(pdfCacheBytes = 0) }
                    refreshDownloadHistoryAvailability()
                    showNotice("已清理 ${formatByteCount(removed)} PDF 缓存")
                }
                .onFailure { showError(it.message ?: "无法清理 PDF 缓存") }
        }
    }

    fun recordPdfPage(pageIndex: Int, pageCount: Int) {
        val document = _state.value.pdfDocument ?: return
        val repositoryFullName = document.repositoryFullName ?: return
        val sha = document.sha ?: return
        val repository = _state.value.repositories.firstOrNull {
            it.fullName.equals(repositoryFullName, ignoreCase = true)
        }
        val normalizedPageCount = pageCount.coerceAtLeast(1)
        val progress = ReadingProgress(
            repositoryFullName = repositoryFullName,
            projectName = _state.value.mobileIndexes[repositoryFullName.lowercase()]?.name
                ?: repository?.name.orEmpty().ifBlank { repositoryFullName.substringAfter('/') },
            pdfPath = document.path,
            pdfName = document.name,
            sha = sha,
            pageIndex = pageIndex.coerceIn(0, normalizedPageCount - 1),
            pageCount = normalizedPageCount,
            lastReadAt = System.currentTimeMillis()
        )
        preferences.saveReadingProgress(progress)
        val recent = preferences.allReadingProgress()
        _state.update { it.copy(recentReading = recent.firstOrNull(), recentReadings = recent) }
    }

    fun openRecentReading(progress: ReadingProgress) {
        val repository = _state.value.repositories.firstOrNull {
            it.fullName.equals(progress.repositoryFullName, ignoreCase = true)
        } ?: preferences.repositorySnapshots().firstOrNull {
            it.fullName.equals(progress.repositoryFullName, ignoreCase = true)
        }
        if (repository == null) {
            showError("找不到 ${progress.projectName} 的本地项目入口")
            return
        }
        openMobilePdf(
            repository,
            MobilePdfOutput(
                id = "recent:${progress.documentId}",
                targetId = "recent",
                name = progress.pdfName,
                entry = "",
                profileId = null,
                pdfPath = progress.pdfPath
            )
        )
    }

    fun togglePdfBookmark(pageIndex: Int, pageCount: Int) {
        val document = _state.value.pdfDocument ?: return
        val repositoryFullName = document.repositoryFullName ?: return
        val bookmark = PdfBookmark(
            repositoryFullName = repositoryFullName,
            pdfPath = document.path,
            pageIndex = pageIndex.coerceIn(0, pageCount.coerceAtLeast(1) - 1)
        )
        val added = preferences.toggleBookmark(bookmark)
        _state.update {
            it.copy(pdfBookmarks = preferences.bookmarks(repositoryFullName, document.path))
        }
        showNotice(if (added) "已添加第 ${bookmark.pageIndex + 1} 页书签" else "已移除书签")
    }

    fun checkForUpdates(silent: Boolean = false) {
        if (_state.value.updateChecking) return
        viewModelScope.launch {
            _state.update {
                it.copy(
                    updateChecking = true,
                    updateMessage = if (silent) it.updateMessage else "正在检查 GitHub Release…"
                )
            }
            runCatching {
                val release = api.latestAndroidRelease()
                val available = isNewerVersion(release.version, currentVersion)
                val downloaded = if (available) downloadStore.findDownloadedUpdate(release) else null
                _state.update {
                    it.copy(
                        updateInfo = release,
                        updateAvailable = available,
                        downloadedApkPath = downloaded?.absolutePath,
                        updateMessage = if (available) {
                            if (downloaded != null) "新版本 ${release.version} 已下载，可以安装"
                            else "发现新版本 ${release.version}"
                        } else {
                            "当前已是最新版本 $currentVersion"
                        }
                    )
                }
                if (available && downloaded == null && _state.value.autoDownloadUpdates) {
                    downloadUpdate()
                }
            }.onFailure { failure ->
                val message = failure.message ?: "检查更新失败"
                _state.update { it.copy(updateMessage = message) }
                if (!silent) showError(message)
            }
            _state.update { it.copy(updateChecking = false) }
        }
    }

    fun downloadUpdate() {
        val release = _state.value.updateInfo ?: run {
            checkForUpdates()
            return
        }
        if (!_state.value.updateAvailable) {
            showNotice("当前已经是最新版本")
            return
        }
        backgroundDownloads.enqueueUpdate(release)
        showNotice("Android ${release.version} 已加入后台下载，息屏后仍会继续")
    }

    fun openReleasePage() {
        val url = _state.value.updateInfo?.releaseUrl
            ?: "https://github.com/Ararataki-number-one/latex-project-manager/releases/latest"
        _state.update { it.copy(externalUrl = url) }
    }

    fun goBack() {
        pendingPdfOpenKey = null
        val current = _state.value
        when (current.screen) {
            ViewerScreen.TEXT -> _state.update {
                it.copy(
                    screen = if (viewerReturnScreen == ViewerScreen.FILES && current.currentRepository == null) ViewerScreen.HOME else viewerReturnScreen,
                    document = null,
                    error = null
                )
            }
            ViewerScreen.PDF -> _state.update {
                it.copy(
                    screen = if (viewerReturnScreen == ViewerScreen.FILES && current.currentRepository == null) ViewerScreen.HOME else viewerReturnScreen,
                    pdfDocument = null,
                    error = null
                )
            }
            ViewerScreen.FILES -> {
                if (current.currentPath.isNotEmpty()) {
                    val parent = current.currentPath.substringBeforeLast('/', "")
                    val repository = current.currentRepository ?: return
                    launchRequest { openRepositoryContents(repository, parent) }
                } else {
                    _state.update {
                        it.copy(
                            screen = ViewerScreen.REPOSITORIES,
                            currentRepository = null,
                            error = null
                        )
                    }
                }
            }
            ViewerScreen.SETTINGS -> _state.update { it.copy(screen = settingsReturnScreen, error = null) }
            ViewerScreen.CONNECT -> _state.update { it.copy(screen = ViewerScreen.REPOSITORIES, error = null) }
            ViewerScreen.HOME, ViewerScreen.REPOSITORIES, ViewerScreen.DOWNLOADS -> Unit
        }
    }

    fun refresh() {
        val current = _state.value
        when (current.screen) {
            ViewerScreen.HOME, ViewerScreen.REPOSITORIES -> loadRepositories()
            ViewerScreen.DOWNLOADS -> Unit
            ViewerScreen.FILES -> current.currentRepository?.let { repository ->
                launchRequest { openRepositoryContents(repository, current.currentPath) }
            }
            ViewerScreen.TEXT -> {
                val document = current.document ?: return
                val item = current.contents.firstOrNull { it.path == document.path } ?: return
                openContent(item)
            }
            ViewerScreen.PDF -> {
                val document = current.pdfDocument ?: return
                val repository = current.repositories.firstOrNull {
                    it.fullName.equals(document.repositoryFullName, ignoreCase = true)
                } ?: current.currentRepository ?: return
                openMobilePdf(repository, MobilePdfOutput(
                    id = "refresh",
                    targetId = "refresh",
                    name = document.name,
                    entry = "",
                    profileId = null,
                    pdfPath = document.path
                ))
            }
            ViewerScreen.SETTINGS -> checkForUpdates()
            ViewerScreen.CONNECT -> Unit
        }
    }

    fun disconnect() {
        tokenStore.clear()
        _state.update { it.copy(tokenStored = false) }
        loadRepositories()
        showNotice("令牌已移除；公开项目仍保留在手机项目库中")
    }

    private fun rootScreenAfterRepositoryRefresh(screen: ViewerScreen): ViewerScreen = when (screen) {
        ViewerScreen.REPOSITORIES, ViewerScreen.DOWNLOADS, ViewerScreen.SETTINGS -> screen
        else -> ViewerScreen.HOME
    }

    fun updateRepositoryQuery(value: String) {
        _state.update { it.copy(repositoryQuery = value) }
    }

    fun updateFileQuery(value: String) {
        _state.update { it.copy(fileQuery = value) }
    }

    fun openCurrentOnGitHub() {
        val current = _state.value
        val url = current.document?.htmlUrl
            ?: current.pdfDocument?.htmlUrl
            ?: current.currentRepository?.htmlUrl
            ?: return
        _state.update { it.copy(externalUrl = url) }
    }

    fun consumeExternalUrl() {
        _state.update { it.copy(externalUrl = null) }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }

    fun clearNotice() {
        _state.update { it.copy(notice = null) }
    }

    fun showNotice(message: String) {
        _state.update { it.copy(notice = message) }
    }

    fun showError(message: String) {
        _state.update { it.copy(error = message) }
    }

    private fun initialState() = ViewerUiState(
        tokenStored = tokenStore.hasToken(),
        repositories = preferences.repositorySnapshots(),
        mobileIndexes = preferences.cachedMobileIndexes(),
        recentReading = preferences.mostRecentReading(),
        recentReadings = preferences.allReadingProgress(),
        downloadedFiles = preferences.downloadedFiles(),
        downloadTasks = preferences.downloadTasks(),
        currentVersion = currentVersion,
        autoCheckUpdates = preferences.autoCheckUpdates,
        autoDownloadUpdates = preferences.autoDownloadUpdates,
        pdfCacheLimitBytes = preferences.pdfCacheLimitBytes,
        glassMode = preferences.glassMode,
        githubLoginSupported = githubClientId.isNotBlank()
    )

    private suspend fun openRepositoryContents(repository: GitHubRepository, path: String) {
        val contents = api.listContents(repository, path, tokenStore.read())
        _state.update {
            it.copy(
                screen = ViewerScreen.FILES,
                currentRepository = repository,
                currentPath = path,
                contents = contents,
                fileQuery = "",
                document = null,
                pdfDocument = null
            )
        }
    }

    private fun openPdf(repository: GitHubRepository, item: GitHubContent) {
        pendingPdfOpenKey = pdfOpenKey(repository.fullName, item.path)
        launchRequest {
            val latest = api.getContent(repository, item.path, tokenStore.read())
            openOrQueuePdfLatest(repository, latest, latest.name)
        }
    }

    private suspend fun openOrQueuePdfLatest(repository: GitHubRepository, latest: GitHubContent, displayName: String) {
        pendingPdfOpenKey = pdfOpenKey(repository.fullName, latest.path)
        val previous = preferences.readingProgress(repository.fullName, latest.path)
        val cacheKey = "${repository.owner}-${repository.name}-${latest.sha}.pdf"
        val file = downloadStore.findPdfPreview(cacheKey)
        if (file == null) {
            backgroundDownloads.enqueuePdf(repository, latest, displayName, preferences.pdfCacheLimitBytes)
            showNotice("${displayName.ifBlank { latest.name }} 已加入后台下载，息屏后仍会继续")
            return
        }
        openPdfDocument(repository, latest, displayName, file.absolutePath, previous)
        pendingPdfOpenKey = null
    }

    private fun openPdfDocument(
        repository: GitHubRepository,
        latest: GitHubContent,
        displayName: String,
        localPath: String,
        previous: ReadingProgress? = preferences.readingProgress(repository.fullName, latest.path)
    ) {
        val initialPage = previous?.pageIndex?.coerceAtLeast(0) ?: 0
        _state.update {
            it.copy(
                screen = ViewerScreen.PDF,
                document = null,
                pdfDocument = PdfDocument(
                    name = displayName.ifBlank { latest.name },
                    path = latest.path,
                    htmlUrl = latest.htmlUrl,
                    localPath = localPath,
                    repositoryFullName = repository.fullName,
                    sha = latest.sha,
                    commitSha = latest.commitSha ?: repository.commitSha,
                    blobSha = latest.gitObjectSha,
                    expectedSize = latest.size.takeIf { size -> size > 0 },
                    initialPage = initialPage
                ),
                pdfBookmarks = preferences.bookmarks(repository.fullName, latest.path)
            )
        }
        refreshCacheUsage()
    }

    private suspend fun refreshMobileIndexes(repositories: List<GitHubRepository>) {
        val token = tokenStore.read()
        val discovered = preferences.cachedMobileIndexes().toMutableMap()
        repositories.chunked(4).forEach { batch ->
            coroutineScope {
                batch.map { repository ->
                    async {
                        repository.fullName.lowercase() to runCatching {
                            api.mobileProjectIndexResult(repository, token)
                        }
                    }
                }.awaitAll()
            }.forEach { (repository, result) ->
                result.onSuccess { fetch ->
                    when (fetch) {
                        is MobileIndexFetchResult.Found -> {
                            preferences.saveMobileIndex(repository, fetch.index)
                            discovered[repository] = fetch.index
                        }
                        MobileIndexFetchResult.Missing -> {
                            preferences.deleteMobileIndex(repository)
                            discovered.remove(repository)
                        }
                        MobileIndexFetchResult.Malformed -> Unit // retain last known-good index
                    }
                }
            }
        }
        _state.update { it.copy(mobileIndexes = discovered) }
    }

    private fun refreshCacheUsage() {
        viewModelScope.launch {
            runCatching { downloadStore.pdfCacheBytes() }
                .onSuccess { bytes -> _state.update { it.copy(pdfCacheBytes = bytes) } }
        }
    }

    private fun refreshDownloadHistoryAvailability() {
        val history = _state.value.downloadedFiles
        if (history.isEmpty()) {
            _state.update { it.copy(downloadAvailability = emptyMap()) }
            return
        }
        viewModelScope.launch {
            val availability = buildMap {
                history.chunked(12).forEach { batch ->
                    coroutineScope {
                        batch.map { item ->
                            async { item.stableId to downloadStore.isDownloadedFileAvailable(item) }
                        }.awaitAll()
                    }.forEach { (id, available) -> put(id, available) }
                }
            }
            _state.update { it.copy(downloadAvailability = availability) }
        }
    }

    private fun formatByteCount(bytes: Long): String = when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "%.1f KB".format(bytes / 1024.0)
        else -> "%.1f MB".format(bytes / 1024.0 / 1024.0)
    }

    private fun rememberRepository(repository: GitHubRepository) {
        preferences.addRepository(repository.fullName)
        _state.update { state ->
            state.copy(
                repositories = state.repositories
                    .filterNot { it.fullName.equals(repository.fullName, ignoreCase = true) }
                    .plus(repository)
                    .sortedByDescending(GitHubRepository::updatedAt)
            )
        }
    }

    fun cancelTransfer() {
        _state.value.transfer?.workId?.let { runCatching { backgroundDownloads.cancel(java.util.UUID.fromString(it)) } }
    }

    private suspend fun resolveMobilePdfAtIndexCommit(
        repository: GitHubRepository,
        output: MobilePdfOutput
    ): Pair<GitHubRepository, GitHubContent> {
        val token = tokenStore.read()
        if (output.id.startsWith("recent:")) {
            val commit = api.resolveCommit(repository, token, forceRefresh = true)
            val pinned = repository.copy(commitSha = commit.commitSha, lastSuccessfulRefreshAt = System.currentTimeMillis())
            preferences.saveRepositorySnapshot(pinned)
            return pinned to api.getContent(pinned, output.pdfPath, token)
        }
        val index = when (val result = api.mobileProjectIndexResult(repository, token)) {
            is MobileIndexFetchResult.Found -> result.index
            MobileIndexFetchResult.Missing -> throw IllegalStateException("项目尚未发布移动端主 PDF 索引")
            MobileIndexFetchResult.Malformed -> throw IllegalStateException("移动端 PDF 索引损坏；已保留上次可用缓存")
        }
        preferences.saveMobileIndex(repository.fullName, index)
        _state.update { state ->
            state.copy(mobileIndexes = state.mobileIndexes + (repository.fullName.lowercase() to index))
        }
        val selected = index.outputs.firstOrNull { it.id == output.id }
            ?: index.outputs.firstOrNull { it.pdfPath == output.pdfPath }
            ?: throw IllegalStateException("最新项目索引中已没有这个 PDF")
        val pinned = repository.copy(
            commitSha = index.commitSha ?: throw IllegalStateException("项目索引缺少固定提交信息"),
            lastSuccessfulRefreshAt = System.currentTimeMillis()
        )
        preferences.saveRepositorySnapshot(pinned)
        return pinned to api.getContent(pinned, selected.pdfPath, token)
    }

    fun cancelDownloadTask(taskId: String) {
        runCatching { java.util.UUID.fromString(taskId) }
            .onSuccess(backgroundDownloads::cancel)
            .onFailure { showError("下载任务标识无效") }
    }

    fun retryDownloadTask(taskId: String) {
        val workId = backgroundDownloads.retry(taskId)
        if (workId == null) showError("找不到可重试的下载信息")
        else showNotice("已重新加入下载队列")
    }

    fun setGlassMode(mode: GlassMode) {
        preferences.glassMode = mode
        _state.update { it.copy(glassMode = mode) }
    }

    fun hideTransferPanel() {
        _state.update { it.copy(transferPanelVisible = false) }
    }

    private fun observeBackgroundDownloads() {
        viewModelScope.launch {
            backgroundDownloads.snapshots.collect { snapshots ->
                val active = snapshots.firstOrNull {
                    it.state in setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED, WorkInfo.State.RUNNING)
                }
                _state.update { current ->
                    val nextTransfer = active?.let { snapshot ->
                        val workId = snapshot.workId.toString()
                        val now = System.currentTimeMillis()
                        val previous = transferSamples[workId]
                        val measuredSpeed = previous?.let { (at, bytes) ->
                            val elapsed = now - at
                            val delta = snapshot.downloaded - bytes
                            if (elapsed >= 500 && delta >= 0) delta * 1_000L / elapsed else null
                        }
                        transferSamples[workId] = now to snapshot.downloaded
                        TransferUiState(
                            workId = workId,
                            label = if (snapshot.state == WorkInfo.State.RUNNING) {
                                snapshot.task.label
                            } else {
                                "排队中 · ${snapshot.task.name}"
                            },
                            downloaded = snapshot.downloaded,
                            total = snapshot.total,
                            waitingForNetwork = snapshot.state != WorkInfo.State.RUNNING,
                            bytesPerSecond = measuredSpeed
                                ?: current.transfer?.takeIf { it.workId == workId }?.bytesPerSecond
                                ?: 0L
                        )
                    }
                    if (nextTransfer == null) transferSamples.clear()
                    current.copy(
                        transfer = nextTransfer,
                        transferPanelVisible = when {
                            nextTransfer == null -> true
                            current.transfer?.workId != nextTransfer.workId -> true
                            else -> current.transferPanelVisible
                        }
                    )
                }

                snapshots
                    .filter { it.state in setOf(WorkInfo.State.SUCCEEDED, WorkInfo.State.FAILED, WorkInfo.State.CANCELLED) }
                    .forEach { snapshot ->
                        val workId = snapshot.workId.toString()
                        if (workId in seenFinishedDownloads || preferences.isDownloadWorkHandled(workId)) return@forEach
                        seenFinishedDownloads += workId
                        when (snapshot.state) {
                            WorkInfo.State.SUCCEEDED -> handleSuccessfulDownload(snapshot)
                            WorkInfo.State.FAILED -> {
                                if (snapshot.task.kind == BackgroundDownloadKind.PDF_PREVIEW) {
                                    pendingPdfOpenKey = null
                                }
                                preferences.markDownloadWorkHandled(workId)
                                showError(snapshot.error ?: "${snapshot.task.name} 下载失败，请重试")
                            }
                            WorkInfo.State.CANCELLED -> {
                                if (snapshot.task.kind == BackgroundDownloadKind.PDF_PREVIEW) {
                                    pendingPdfOpenKey = null
                                }
                                preferences.markDownloadWorkHandled(workId)
                                showNotice("已取消 ${snapshot.task.name}")
                            }
                            else -> Unit
                        }
                    }
            }
        }
    }

    private fun observePersistentDownloads() {
        viewModelScope.launch {
            backgroundDownloads.persistentTasks.collect { tasks ->
                _state.update { it.copy(downloadTasks = tasks) }
            }
        }
    }

    private fun handleSuccessfulDownload(snapshot: BackgroundDownloadSnapshot) {
        val workId = snapshot.workId.toString()
        when (snapshot.task.kind) {
            BackgroundDownloadKind.PUBLIC_FILE,
            BackgroundDownloadKind.REPOSITORY_ARCHIVE -> {
                val downloaded = snapshot.downloadedFile() ?: run {
                    preferences.markDownloadWorkHandled(workId)
                    showError("下载已结束，但无法读取保存位置")
                    return
                }
                recordDownload(
                    downloaded.copy(
                        kind = if (snapshot.task.kind == BackgroundDownloadKind.REPOSITORY_ARCHIVE) {
                            DownloadHistoryKind.PROJECT_ARCHIVE
                        } else {
                            downloaded.kind
                        },
                        sourceRepository = snapshot.task.repositoryFullName,
                        sourcePath = snapshot.task.path
                    ),
                    workId
                )
            }
            BackgroundDownloadKind.PDF_PREVIEW -> {
                val localPath = snapshot.output.getString(BackgroundDownloadManager.KEY_OUTPUT_PATH)
                val repository = repositoryFor(snapshot.task)
                val path = snapshot.task.path
                val sha = snapshot.task.sha
                if (localPath.isNullOrBlank() || repository == null || path.isNullOrBlank() || sha.isNullOrBlank()) {
                    showError("PDF 已下载，但缓存信息不完整，请重新打开")
                } else {
                    val item = GitHubContent(
                        name = path.substringAfterLast('/'),
                        path = path,
                        kind = GitHubContentKind.FILE,
                        size = snapshot.output.getLong(BackgroundDownloadManager.KEY_OUTPUT_SIZE, snapshot.task.size),
                        sha = sha,
                        htmlUrl = "${repository.htmlUrl}/blob/${repository.defaultBranch}/$path",
                        downloadUrl = snapshot.task.downloadUrl
                    )
                    runCatching {
                        downloadStore.cachedPdfAsDownloadedFile(localPath, snapshot.task.name).copy(
                            kind = DownloadHistoryKind.PDF,
                            sourceRepository = repository.fullName,
                            sourcePath = path
                        )
                    }.onSuccess { historyItem ->
                        recordDownload(historyItem, workId, announce = false)
                    }
                    val key = pdfOpenKey(repository.fullName, path)
                    if (pendingPdfOpenKey == key) {
                        openPdfDocument(repository, item, snapshot.task.name, localPath)
                        pendingPdfOpenKey = null
                        showNotice("${snapshot.task.name} 已下载，可以离线阅读")
                    } else {
                        showNotice("${snapshot.task.name} 已缓存，可从首页或项目中打开")
                    }
                }
                preferences.markDownloadWorkHandled(workId)
            }
            BackgroundDownloadKind.APP_UPDATE -> {
                val path = snapshot.output.getString(BackgroundDownloadManager.KEY_OUTPUT_PATH)
                if (path.isNullOrBlank()) {
                    showError("更新包下载完成，但没有找到安装文件")
                } else {
                    _state.update {
                        it.copy(
                            downloadedApkPath = path,
                            updateMessage = "新版本 ${snapshot.task.releaseVersion.orEmpty()} 已下载，可以安装"
                        )
                    }
                    runCatching {
                        downloadStore.downloadedUpdateAsFile(path, snapshot.task.name).copy(
                            kind = DownloadHistoryKind.APP_PACKAGE,
                            sourcePath = snapshot.task.releaseTag
                        )
                    }.onSuccess { historyItem ->
                        recordDownload(historyItem, workId, announce = false)
                    }
                    showNotice("更新包下载完成，请确认安装")
                }
                preferences.markDownloadWorkHandled(workId)
            }
        }
    }

    private fun repositoryFor(task: BackgroundDownloadTask): GitHubRepository? {
        val fullName = task.repositoryFullName ?: return null
        return _state.value.repositories.firstOrNull { it.fullName.equals(fullName, ignoreCase = true) }
            ?: GitHubRepository(
                name = task.repository ?: return null,
                fullName = fullName,
                owner = task.owner ?: return null,
                description = null,
                isPrivate = false,
                defaultBranch = task.branch ?: "main",
                updatedAt = "",
                htmlUrl = "https://github.com/$fullName",
                sizeKb = 0
            )
    }

    private fun BackgroundDownloadSnapshot.downloadedFile(): DownloadedFile? {
        val name = output.getString(BackgroundDownloadManager.KEY_OUTPUT_NAME) ?: return null
        val uri = output.getString(BackgroundDownloadManager.KEY_OUTPUT_URI) ?: return null
        val path = output.getString(BackgroundDownloadManager.KEY_OUTPUT_PATH) ?: return null
        val mime = output.getString(BackgroundDownloadManager.KEY_OUTPUT_MIME) ?: "application/octet-stream"
        return DownloadedFile(name, uri, path, mime, output.getLong(BackgroundDownloadManager.KEY_OUTPUT_SIZE, 0L))
    }

    private fun pdfOpenKey(repositoryFullName: String, path: String): String =
        "${repositoryFullName.lowercase()}:${path.replace('\\', '/')}"

    private fun launchRequest(block: suspend () -> Unit) {
        if (_state.value.loading) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            runCatching { block() }
                .onFailure { failure -> showError(failure.message ?: "操作失败，请稍后重试") }
            _state.update { it.copy(loading = false) }
        }
    }

    private fun Throwable.toRefreshFailure(): RepositoryRefreshFailure = when (this) {
        is GitHubRequestException -> RepositoryRefreshFailure(kind, message.orEmpty(), retryAfterEpochMillis)
        else -> RepositoryRefreshFailure(
            com.zqy.latexviewer.model.RepositoryRefreshFailureKind.UNKNOWN,
            message ?: "项目刷新失败"
        )
    }

    companion object {
        private const val MAX_INLINE_BYTES = 1_500_000L

        fun factory(
            api: GitHubApi,
            tokenStore: SecureTokenStore,
            downloadStore: DownloadStore,
            backgroundDownloads: BackgroundDownloadManager,
            preferences: AppPreferences,
            currentVersion: String,
            githubClientId: String = ""
        ): ViewModelProvider.Factory {
            return object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(ViewerViewModel::class.java))
                    return ViewerViewModel(
                        api,
                        tokenStore,
                        downloadStore,
                        backgroundDownloads,
                        preferences,
                        currentVersion,
                        githubClientId
                    ) as T
                }
            }
        }

        fun isNewerVersion(candidate: String, current: String): Boolean {
            fun parts(value: String): List<Int> = value
                .trim()
                .removePrefix("v")
                .substringBefore('-')
                .split('.')
                .map { it.toIntOrNull() ?: 0 }
            val left = parts(candidate)
            val right = parts(current)
            for (index in 0 until maxOf(left.size, right.size)) {
                val comparison = (left.getOrElse(index) { 0 }).compareTo(right.getOrElse(index) { 0 })
                if (comparison != 0) return comparison > 0
            }
            return false
        }

        fun isPdfFile(name: String): Boolean = name.endsWith(".pdf", ignoreCase = true)

        fun mimeTypeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
            "pdf" -> "application/pdf"
            "zip" -> "application/zip"
            "tex", "ltx" -> "text/x-tex"
            "bib", "cls", "sty", "bst", "bbx", "cbx", "lbx", "dtx", "ins", "txt", "md", "log" -> "text/plain"
            "json" -> "application/json"
            "xml" -> "application/xml"
            "html", "htm" -> "text/html"
            "css" -> "text/css"
            "js" -> "text/javascript"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            else -> "application/octet-stream"
        }
    }
}
