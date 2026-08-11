package com.zqy.latexviewer.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.zqy.latexviewer.data.AppPreferences
import com.zqy.latexviewer.data.DownloadStore
import com.zqy.latexviewer.data.GitHubApi
import com.zqy.latexviewer.data.SecureTokenStore
import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.TextDocument
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ViewerScreen {
    CONNECT,
    REPOSITORIES,
    FILES,
    TEXT,
    SETTINGS
}

data class TransferUiState(
    val label: String,
    val downloaded: Long = 0,
    val total: Long = -1
)

data class ViewerUiState(
    val screen: ViewerScreen = ViewerScreen.CONNECT,
    val tokenStored: Boolean = false,
    val repositories: List<GitHubRepository> = emptyList(),
    val repositoryQuery: String = "",
    val currentRepository: GitHubRepository? = null,
    val currentPath: String = "",
    val contents: List<GitHubContent> = emptyList(),
    val fileQuery: String = "",
    val document: TextDocument? = null,
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
    val downloadedApkPath: String? = null
)

class ViewerViewModel(
    private val api: GitHubApi,
    private val tokenStore: SecureTokenStore,
    private val downloadStore: DownloadStore,
    private val preferences: AppPreferences,
    private val currentVersion: String
) : ViewModel() {
    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<ViewerUiState> = _state.asStateFlow()
    private var settingsReturnScreen = ViewerScreen.REPOSITORIES

    init {
        if (_state.value.tokenStored) loadRepositories()
        if (_state.value.autoCheckUpdates) checkForUpdates(silent = true)
    }

    fun connect(token: String, quickRepository: String) {
        val normalizedToken = token.trim()
        val normalizedRepository = quickRepository.trim()
        if (normalizedToken.isEmpty() && !tokenStore.hasToken() && normalizedRepository.isEmpty()) {
            showError("请输入公开仓库地址，或填写只读 GitHub 令牌")
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

    fun loadRepositories() {
        val token = tokenStore.read()
        if (token.isNullOrBlank()) {
            _state.update { it.copy(screen = ViewerScreen.CONNECT, tokenStored = false, loading = false) }
            return
        }
        launchRequest {
            val repositories = api.listRepositories(token)
            _state.update {
                it.copy(
                    screen = ViewerScreen.REPOSITORIES,
                    repositories = repositories,
                    currentRepository = null,
                    currentPath = "",
                    contents = emptyList(),
                    document = null
                )
            }
        }
    }

    fun openRepositoryReference(reference: String) {
        launchRequest {
            val repository = api.getRepository(reference, tokenStore.read())
            openRepositoryContents(repository, "")
        }
    }

    fun openRepository(repository: GitHubRepository) {
        launchRequest { openRepositoryContents(repository, "") }
    }

    fun openContent(item: GitHubContent) {
        val repository = _state.value.currentRepository ?: return
        when (item.kind) {
            GitHubContentKind.DIRECTORY -> launchRequest { openRepositoryContents(repository, item.path) }
            GitHubContentKind.FILE -> {
                if (!api.isInlineText(item.name) || item.size > MAX_INLINE_BYTES) {
                    _state.update { it.copy(externalUrl = item.htmlUrl ?: repository.htmlUrl) }
                    return
                }
                launchRequest {
                    val content = api.readTextFile(repository, item, tokenStore.read())
                    _state.update {
                        it.copy(
                            screen = ViewerScreen.TEXT,
                            document = TextDocument(item.name, item.path, content, item.htmlUrl)
                        )
                    }
                }
            }
            else -> _state.update { it.copy(externalUrl = item.htmlUrl ?: repository.htmlUrl) }
        }
    }

    fun downloadFile(item: GitHubContent, destination: Uri) {
        val repository = _state.value.currentRepository ?: return
        if (item.kind != GitHubContentKind.FILE) return
        launchTransfer("正在下载 ${item.name}") {
            downloadStore.saveDocument(destination) { output ->
                api.downloadFile(repository, item, tokenStore.read(), output, ::updateTransfer)
            }
            showNotice("${item.name} 已保存到所选位置")
        }
    }

    fun downloadRepository(repository: GitHubRepository, destination: Uri) {
        launchTransfer("正在下载 ${repository.name}.zip") {
            downloadStore.saveDocument(destination) { output ->
                api.downloadRepositoryArchive(repository, tokenStore.read(), output, ::updateTransfer)
            }
            showNotice("${repository.name} 项目 ZIP 已保存")
        }
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
        launchTransfer("正在下载 Android ${release.version}") {
            val file = downloadStore.saveUpdate(release) { output ->
                api.downloadAndroidUpdate(release, output, ::updateTransfer)
            }
            _state.update {
                it.copy(
                    downloadedApkPath = file.absolutePath,
                    updateMessage = "新版本 ${release.version} 已下载，可以安装"
                )
            }
            showNotice("更新包下载完成，请确认安装")
        }
    }

    fun openReleasePage() {
        val url = _state.value.updateInfo?.releaseUrl
            ?: "https://github.com/Ararataki-number-one/latex-project-manager/releases/latest"
        _state.update { it.copy(externalUrl = url) }
    }

    fun goBack() {
        val current = _state.value
        when (current.screen) {
            ViewerScreen.TEXT -> _state.update { it.copy(screen = ViewerScreen.FILES, document = null, error = null) }
            ViewerScreen.FILES -> {
                if (current.currentPath.isNotEmpty()) {
                    val parent = current.currentPath.substringBeforeLast('/', "")
                    val repository = current.currentRepository ?: return
                    launchRequest { openRepositoryContents(repository, parent) }
                } else if (current.tokenStored) {
                    _state.update { it.copy(screen = ViewerScreen.REPOSITORIES, currentRepository = null, error = null) }
                } else {
                    _state.update { it.copy(screen = ViewerScreen.CONNECT, currentRepository = null, error = null) }
                }
            }
            ViewerScreen.SETTINGS -> _state.update { it.copy(screen = settingsReturnScreen, error = null) }
            ViewerScreen.REPOSITORIES -> _state.update { it.copy(screen = ViewerScreen.CONNECT, error = null) }
            ViewerScreen.CONNECT -> Unit
        }
    }

    fun refresh() {
        val current = _state.value
        when (current.screen) {
            ViewerScreen.REPOSITORIES -> loadRepositories()
            ViewerScreen.FILES -> current.currentRepository?.let { repository ->
                launchRequest { openRepositoryContents(repository, current.currentPath) }
            }
            ViewerScreen.TEXT -> {
                val document = current.document ?: return
                val item = current.contents.firstOrNull { it.path == document.path } ?: return
                openContent(item)
            }
            ViewerScreen.SETTINGS -> checkForUpdates()
            ViewerScreen.CONNECT -> Unit
        }
    }

    fun disconnect() {
        tokenStore.clear()
        _state.value = initialState().copy(
            updateInfo = _state.value.updateInfo,
            updateAvailable = _state.value.updateAvailable,
            updateMessage = _state.value.updateMessage,
            downloadedApkPath = _state.value.downloadedApkPath
        )
    }

    fun updateRepositoryQuery(value: String) {
        _state.update { it.copy(repositoryQuery = value) }
    }

    fun updateFileQuery(value: String) {
        _state.update { it.copy(fileQuery = value) }
    }

    fun openCurrentOnGitHub() {
        val current = _state.value
        val url = current.document?.htmlUrl ?: current.currentRepository?.htmlUrl ?: return
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
        currentVersion = currentVersion,
        autoCheckUpdates = preferences.autoCheckUpdates,
        autoDownloadUpdates = preferences.autoDownloadUpdates
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
                document = null
            )
        }
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

    private fun launchTransfer(label: String, block: suspend () -> Unit) {
        if (_state.value.transfer != null) {
            showError("已有下载正在进行，请稍候")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(transfer = TransferUiState(label), error = null) }
            runCatching { block() }
                .onFailure { failure -> showError(failure.message ?: "下载失败，请稍后重试") }
            _state.update { it.copy(transfer = null) }
        }
    }

    private fun updateTransfer(downloaded: Long, total: Long) {
        _state.update { state ->
            state.copy(transfer = state.transfer?.copy(downloaded = downloaded, total = total))
        }
    }

    companion object {
        private const val MAX_INLINE_BYTES = 1_500_000

        fun factory(
            api: GitHubApi,
            tokenStore: SecureTokenStore,
            downloadStore: DownloadStore,
            preferences: AppPreferences,
            currentVersion: String
        ): ViewModelProvider.Factory {
            return object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(ViewerViewModel::class.java))
                    return ViewerViewModel(api, tokenStore, downloadStore, preferences, currentVersion) as T
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
    }
}
