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
import com.zqy.latexviewer.data.SecureTokenStore
import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import com.zqy.latexviewer.model.PdfDocument
import com.zqy.latexviewer.model.ReadingProgress
import com.zqy.latexviewer.model.TextDocument
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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
    val waitingForNetwork: Boolean = false
)

data class ViewerUiState(
    val screen: ViewerScreen = ViewerScreen.HOME,
    val tokenStored: Boolean = false,
    val repositories: List<GitHubRepository> = emptyList(),
    val mobileIndexes: Map<String, MobileProjectIndex> = emptyMap(),
    val recentReading: ReadingProgress? = null,
    val repositoryQuery: String = "",
    val currentRepository: GitHubRepository? = null,
    val currentPath: String = "",
    val contents: List<GitHubContent> = emptyList(),
    val fileQuery: String = "",
    val document: TextDocument? = null,
    val pdfDocument: PdfDocument? = null,
    val completedDownload: DownloadedFile? = null,
    val completedDownloadWorkId: String? = null,
    val downloadedFiles: List<DownloadedFile> = emptyList(),
    val externalFile: DownloadedFile? = null,
    val loading: Boolean = false,
    val transfer: TransferUiState? = null,
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
    val pdfCacheLimitBytes: Long = 512L * 1024 * 1024
)

class ViewerViewModel(
    private val api: GitHubApi,
    private val tokenStore: SecureTokenStore,
    private val downloadStore: DownloadStore,
    private val backgroundDownloads: BackgroundDownloadManager,
    private val preferences: AppPreferences,
    private val currentVersion: String
) : ViewModel() {
    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<ViewerUiState> = _state.asStateFlow()
    private var settingsReturnScreen = ViewerScreen.HOME
    private var viewerReturnScreen = ViewerScreen.HOME
    private val seenFinishedDownloads = mutableSetOf<String>()

    init {
        observeBackgroundDownloads()
        loadRepositories()
        refreshCacheUsage()
        if (_state.value.autoCheckUpdates) checkForUpdates(silent = true)
    }

    fun connect(token: String, quickRepository: String) {
        val normalizedToken = token.trim()
        val normalizedRepository = quickRepository.trim()
        if (normalizedToken.isEmpty() && !tokenStore.hasToken() && normalizedRepository.isEmpty()) {
            showError("请输入 GitHub 仓库地址")
            return
        }
        if (normalizedToken.isNotEmpty()) tokenStore.save(normalizedToken)
        _state.update { it.copy(tokenStored = tokenStore.hasToken(), error = null) }
        if (normalizedRepository.isNotEmpty()) {
            openRepositoryReference(normalizedRepository)
        } else {
            loadRepositories()
        }
    }

    fun openAddProject() {
        _state.update { it.copy(screen = ViewerScreen.CONNECT, error = null) }
    }

    fun openHome() {
        _state.update { it.copy(screen = ViewerScreen.HOME, currentRepository = null, currentPath = "", error = null) }
    }

    fun openProjects() {
        _state.update { it.copy(screen = ViewerScreen.REPOSITORIES, currentRepository = null, currentPath = "", error = null) }
    }

    fun openDownloads() {
        _state.update { it.copy(screen = ViewerScreen.DOWNLOADS, currentRepository = null, currentPath = "", error = null) }
    }

    fun loadRepositories() {
        val token = tokenStore.read()
        val savedReferences = preferences.savedRepositoryReferences()
        if (savedReferences.isEmpty() && token.isNullOrBlank()) {
            _state.update {
                it.copy(
                    screen = rootScreenAfterRepositoryRefresh(it.screen),
                    repositories = emptyList(),
                    mobileIndexes = emptyMap(),
                    tokenStored = false,
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
            var failed = 0
            val repositories = if (savedReferences.isNotEmpty()) {
                savedReferences.mapNotNull { reference ->
                    runCatching { api.getRepository(reference, token) }
                        .onFailure { failed += 1 }
                        .getOrNull()
                }
            } else {
                api.listRepositories(token.orEmpty())
            }
            _state.update {
                it.copy(
                    screen = rootScreenAfterRepositoryRefresh(it.screen),
                    repositories = repositories.sortedByDescending(GitHubRepository::updatedAt),
                    tokenStored = tokenStore.hasToken(),
                    currentRepository = null,
                    currentPath = "",
                    contents = emptyList(),
                    document = null,
                    pdfDocument = null
                )
            }
            refreshMobileIndexes(repositories)
            if (failed > 0) {
                showNotice("$failed 个项目暂时无法访问，请检查仓库地址或令牌权限")
            }
        }
    }

    fun openRepositoryReference(reference: String) {
        launchRequest {
            val repository = api.getRepository(reference, tokenStore.read())
            rememberRepository(repository)
            openRepositoryContents(repository, "")
        }
    }

    fun openRepository(repository: GitHubRepository) {
        rememberRepository(repository)
        launchRequest { openRepositoryContents(repository, "") }
    }

    fun openMobilePdf(repository: GitHubRepository, output: MobilePdfOutput) {
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
                            initialPage = previous.pageIndex.coerceAtLeast(0)
                        )
                    )
                }
                showNotice("已打开离线缓存，正在后台检查最新版")
                runCatching {
                    val latest = api.getContent(repository, output.pdfPath, tokenStore.read())
                    if (latest.sha != previous.sha) {
                        openOrQueuePdfLatest(repository, latest, output.name)
                        showNotice("发现新版本，正在后台更新 ${output.name}")
                    }
                }.onFailure { showNotice("当前离线阅读；联网后可检查最新版") }
            } else {
                launchRequest {
                    val latest = api.getContent(repository, output.pdfPath, tokenStore.read())
                    openOrQueuePdfLatest(repository, latest, output.name)
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
                            localPath = local.absolutePath
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

    private fun recordDownload(downloaded: DownloadedFile, workId: String) {
        preferences.saveDownloadedFile(downloaded)
        _state.update {
            it.copy(
                completedDownload = it.completedDownload ?: downloaded,
                completedDownloadWorkId = it.completedDownloadWorkId ?: workId,
                downloadedFiles = (listOf(downloaded) + it.downloadedFiles.filterNot { item -> item.contentUri == downloaded.contentUri }).take(30)
            )
        }
    }

    fun consumeExternalFile() {
        _state.update { it.copy(externalFile = null) }
    }

    fun openSettings() {
        val current = _state.value.screen
        if (current == ViewerScreen.SETTINGS) return
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
        _state.update { it.copy(recentReading = progress) }
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
        mobileIndexes = preferences.cachedMobileIndexes(),
        recentReading = preferences.mostRecentReading(),
        downloadedFiles = preferences.downloadedFiles(),
        currentVersion = currentVersion,
        autoCheckUpdates = preferences.autoCheckUpdates,
        autoDownloadUpdates = preferences.autoDownloadUpdates,
        pdfCacheLimitBytes = preferences.pdfCacheLimitBytes
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
        launchRequest {
            val latest = api.getContent(repository, item.path, tokenStore.read())
            openOrQueuePdfLatest(repository, latest, latest.name)
        }
    }

    private suspend fun openOrQueuePdfLatest(repository: GitHubRepository, latest: GitHubContent, displayName: String) {
        val previous = preferences.readingProgress(repository.fullName, latest.path)
        val cacheKey = "${repository.owner}-${repository.name}-${latest.sha}.pdf"
        val file = downloadStore.findPdfPreview(cacheKey)
        if (file == null) {
            backgroundDownloads.enqueuePdf(repository, latest, displayName, preferences.pdfCacheLimitBytes)
            showNotice("${displayName.ifBlank { latest.name }} 已加入后台下载，息屏后仍会继续")
            return
        }
        openPdfDocument(repository, latest, displayName, file.absolutePath, previous)
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
                    initialPage = initialPage
                )
            )
        }
        refreshCacheUsage()
    }

    private suspend fun refreshMobileIndexes(repositories: List<GitHubRepository>) {
        val token = tokenStore.read()
        val discovered = mutableMapOf<String, MobileProjectIndex>()
        repositories.chunked(4).forEach { batch ->
            coroutineScope {
                batch.map { repository ->
                    async {
                        val index = api.mobileProjectIndex(repository, token)
                        repository.fullName.lowercase() to index
                    }
                }.awaitAll()
            }.forEach { (repository, index) ->
                preferences.saveMobileIndex(repository, index)
                if (index != null) discovered[repository] = index
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

    private fun observeBackgroundDownloads() {
        viewModelScope.launch {
            backgroundDownloads.snapshots.collect { snapshots ->
                val active = snapshots.firstOrNull {
                    it.state in setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED, WorkInfo.State.RUNNING)
                }
                _state.update { current ->
                    current.copy(
                        transfer = active?.let { snapshot ->
                            TransferUiState(
                                workId = snapshot.workId.toString(),
                                label = if (snapshot.state == WorkInfo.State.RUNNING) {
                                    snapshot.task.label
                                } else {
                                    "排队中 · ${snapshot.task.name}"
                                },
                                downloaded = snapshot.downloaded,
                                total = snapshot.total,
                                waitingForNetwork = snapshot.state != WorkInfo.State.RUNNING
                            )
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
                                preferences.markDownloadWorkHandled(workId)
                                showError(snapshot.error ?: "${snapshot.task.name} 下载失败，请重试")
                            }
                            WorkInfo.State.CANCELLED -> {
                                preferences.markDownloadWorkHandled(workId)
                                showNotice("已取消 ${snapshot.task.name}")
                            }
                            else -> Unit
                        }
                    }
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
                recordDownload(downloaded, workId)
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
                    openPdfDocument(repository, item, snapshot.task.name, localPath)
                    showNotice("${snapshot.task.name} 已下载，可以离线阅读")
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

    private fun launchRequest(block: suspend () -> Unit) {
        if (_state.value.loading) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            runCatching { block() }
                .onFailure { failure -> showError(failure.message ?: "操作失败，请稍后重试") }
            _state.update { it.copy(loading = false) }
        }
    }

    companion object {
        private const val MAX_INLINE_BYTES = 1_500_000L

        fun factory(
            api: GitHubApi,
            tokenStore: SecureTokenStore,
            downloadStore: DownloadStore,
            backgroundDownloads: BackgroundDownloadManager,
            preferences: AppPreferences,
            currentVersion: String
        ): ViewModelProvider.Factory {
            return object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(ViewerViewModel::class.java))
                    return ViewerViewModel(api, tokenStore, downloadStore, backgroundDownloads, preferences, currentVersion) as T
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
