package com.zqy.latexviewer.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.zqy.latexviewer.data.GitHubApi
import com.zqy.latexviewer.data.SecureTokenStore
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
    TEXT
}

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
    val error: String? = null,
    val externalUrl: String? = null
)

class ViewerViewModel(
    private val api: GitHubApi,
    private val tokenStore: SecureTokenStore
) : ViewModel() {
    private val _state = MutableStateFlow(ViewerUiState(tokenStored = tokenStore.hasToken()))
    val state: StateFlow<ViewerUiState> = _state.asStateFlow()

    init {
        if (_state.value.tokenStored) loadRepositories()
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
            ViewerScreen.CONNECT -> Unit
        }
    }

    fun disconnect() {
        tokenStore.clear()
        _state.value = ViewerUiState()
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

    private fun showError(message: String) {
        _state.update { it.copy(error = message) }
    }

    companion object {
        private const val MAX_INLINE_BYTES = 1_500_000

        fun factory(api: GitHubApi, tokenStore: SecureTokenStore): ViewModelProvider.Factory {
            return object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(ViewerViewModel::class.java))
                    return ViewerViewModel(api, tokenStore) as T
                }
            }
        }
    }
}
