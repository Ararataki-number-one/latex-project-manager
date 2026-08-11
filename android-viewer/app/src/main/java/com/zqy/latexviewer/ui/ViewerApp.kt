package com.zqy.latexviewer.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Article
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SystemUpdateAlt
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.ui.theme.LaTeXViewerTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LaTeXViewerApp(viewModel: ViewerViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current
    val apkInstaller = remember(context) { ApkInstaller(context.applicationContext) }

    fun installDownloadedUpdate() {
        val path = state.downloadedApkPath ?: return
        if (!apkInstaller.canRequestInstall()) {
            apkInstaller.openInstallPermission()
            viewModel.showNotice("请允许此应用安装更新，返回后再次点击“安装更新”")
            return
        }
        runCatching { apkInstaller.install(path) }
            .onFailure { viewModel.showError(it.message ?: "无法打开 Android 安装界面") }
    }

    BackHandler(enabled = state.screen != ViewerScreen.REPOSITORIES) { viewModel.goBack() }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    LaunchedEffect(state.externalUrl) {
        state.externalUrl?.let { url ->
            runCatching { uriHandler.openUri(url) }
            viewModel.consumeExternalUrl()
        }
    }

    LaunchedEffect(state.externalFile) {
        state.externalFile?.let { file ->
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(file.contentUri), file.mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runCatching {
                context.startActivity(Intent.createChooser(intent, "打开 ${file.name}"))
            }.onFailure { failure ->
                val message = if (failure is ActivityNotFoundException) {
                    "手机上没有可以打开 ${file.name} 的应用"
                } else {
                    failure.message ?: "无法打开已下载的文件"
                }
                viewModel.showError(message)
            }
            viewModel.consumeExternalFile()
        }
    }

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearNotice()
        }
    }

    LaTeXViewerTheme {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            contentWindowInsets = WindowInsets.safeDrawing,
            snackbarHost = { SnackbarHost(snackbarHostState) },
            topBar = {
                ViewerTopBar(
                    state = state,
                    onBack = viewModel::goBack,
                    onAddProject = viewModel::openAddProject,
                    onRefresh = viewModel::refresh,
                    onOpenGitHub = viewModel::openCurrentOnGitHub,
                    onSettings = viewModel::openSettings,
                    onDisconnect = viewModel::disconnect
                )
            }
        ) { contentPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(contentPadding)
            ) {
                when (state.screen) {
                    ViewerScreen.CONNECT -> ConnectScreen(
                        tokenStored = state.tokenStored,
                        loading = state.loading,
                        onConnect = viewModel::connect,
                        onSettings = viewModel::openSettings,
                        onTokenHelp = { uriHandler.openUri("https://github.com/settings/personal-access-tokens/new") }
                    )
                    ViewerScreen.REPOSITORIES -> RepositoryListScreen(
                        state = state,
                        onQueryChange = viewModel::updateRepositoryQuery,
                        onOpen = viewModel::openRepository,
                        onDownload = viewModel::downloadRepository,
                        onAdd = viewModel::openAddProject,
                        onRemove = viewModel::removeRepository,
                        onOpenSettings = viewModel::openSettings
                    )
                    ViewerScreen.FILES -> FileListScreen(
                        state = state,
                        onQueryChange = viewModel::updateFileQuery,
                        onOpen = viewModel::openContent,
                        onDownloadFile = viewModel::downloadFile,
                        onDownloadProject = viewModel::downloadRepository
                    )
                    ViewerScreen.TEXT -> TextPreviewScreen(
                        state,
                        onDownload = viewModel::downloadFile
                    )
                    ViewerScreen.PDF -> PdfPreviewScreen(
                        state,
                        onDownload = viewModel::downloadFile
                    )
                    ViewerScreen.SETTINGS -> SettingsScreen(
                        state = state,
                        onAutoCheckChange = viewModel::setAutoCheckUpdates,
                        onAutoDownloadChange = viewModel::setAutoDownloadUpdates,
                        onCheck = { viewModel.checkForUpdates() },
                        onDownloadUpdate = viewModel::downloadUpdate,
                        onInstallUpdate = ::installDownloadedUpdate,
                        onOpenRelease = viewModel::openReleasePage
                    )
                }
                if (state.loading) {
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .align(Alignment.TopCenter),
                        color = MaterialTheme.colorScheme.secondary,
                        trackColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                }
                state.transfer?.let { transfer ->
                    TransferCard(
                        transfer,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp)
                    )
                }
                state.completedDownload?.let { download ->
                    DownloadCompleteDialog(
                        download = download,
                        onOpen = viewModel::openCompletedDownload,
                        onDismiss = viewModel::dismissCompletedDownload
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ViewerTopBar(
    state: ViewerUiState,
    onBack: () -> Unit,
    onAddProject: () -> Unit,
    onRefresh: () -> Unit,
    onOpenGitHub: () -> Unit,
    onSettings: () -> Unit,
    onDisconnect: () -> Unit
) {
    val title = when (state.screen) {
        ViewerScreen.REPOSITORIES -> "项目"
        ViewerScreen.FILES -> state.currentRepository?.name ?: "项目文件"
        ViewerScreen.TEXT -> state.document?.name ?: "代码查看器"
        ViewerScreen.PDF -> state.pdfDocument?.name ?: "PDF 查看器"
        ViewerScreen.SETTINGS -> "设置与更新"
        ViewerScreen.CONNECT -> "添加项目"
    }
    TopAppBar(
        title = {
            Column {
                Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                if (state.screen == ViewerScreen.FILES && state.currentPath.isNotEmpty()) {
                    Text(
                        state.currentPath,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        },
        navigationIcon = {
            if (state.screen != ViewerScreen.REPOSITORIES) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                }
            }
        },
        actions = {
            if (state.screen == ViewerScreen.REPOSITORIES) {
                IconButton(onClick = onAddProject) {
                    Icon(Icons.Outlined.Add, contentDescription = "添加项目")
                }
            }
            if (state.screen == ViewerScreen.FILES || state.screen == ViewerScreen.TEXT || state.screen == ViewerScreen.PDF) {
                IconButton(onClick = onOpenGitHub) {
                    Icon(Icons.Outlined.OpenInNew, contentDescription = "在 GitHub 中打开")
                }
            }
            if (state.screen != ViewerScreen.SETTINGS) {
                IconButton(onClick = onRefresh, enabled = !state.loading) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新")
                }
                IconButton(onClick = onSettings) {
                    Icon(Icons.Outlined.Settings, contentDescription = "设置与更新")
                }
            }
            if (state.tokenStored) {
                IconButton(onClick = onDisconnect) {
                    Icon(Icons.Outlined.Logout, contentDescription = "移除令牌并退出")
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.background,
            titleContentColor = MaterialTheme.colorScheme.onBackground
        )
    )
}

@Composable
private fun ConnectScreen(
    tokenStored: Boolean,
    loading: Boolean,
    onConnect: (String, String) -> Unit,
    onSettings: () -> Unit,
    onTokenHelp: () -> Unit
) {
    var repository by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf("") }
    var showToken by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(
            modifier = Modifier.size(72.dp),
            shape = RoundedCornerShape(22.dp),
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.FolderOpen, contentDescription = null, modifier = Modifier.size(32.dp))
            }
        }
        Spacer(Modifier.height(24.dp))
        Text("添加 GitHub 项目", style = MaterialTheme.typography.headlineLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            "项目会保存在手机项目库中，可以继续添加多个。",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(34.dp))

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            OutlinedTextField(
                value = repository,
                onValueChange = { repository = it },
                label = { Text("GitHub 仓库地址") },
                placeholder = { Text("owner/repository 或完整网址") },
                leadingIcon = { Icon(Icons.Outlined.CloudQueue, contentDescription = null) },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("只读 GitHub 令牌（可选）") },
                placeholder = { Text(if (tokenStored) "已安全保存，可留空" else "github_pat_…") },
                leadingIcon = { Icon(Icons.Outlined.Key, contentDescription = null) },
                trailingIcon = {
                    IconButton(onClick = { showToken = !showToken }) {
                        Icon(
                            if (showToken) Icons.Outlined.LockOpen else Icons.Outlined.Lock,
                            contentDescription = if (showToken) "隐藏令牌" else "显示令牌"
                        )
                    }
                },
                visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = { onConnect(token, repository) },
                enabled = !loading && (repository.isNotBlank() || token.isNotBlank() || tokenStored),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text(if (repository.isBlank()) "载入可访问仓库" else "添加并打开项目")
                }
            }
            OutlinedButton(
                onClick = onSettings,
                enabled = !loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(14.dp)
            ) {
                Icon(Icons.Outlined.SystemUpdateAlt, contentDescription = null, modifier = Modifier.size(19.dp))
                Spacer(Modifier.width(8.dp))
                Text("设置与应用更新")
            }
        }

        Spacer(Modifier.height(24.dp))
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("只读与本机安全", fontWeight = FontWeight.SemiBold)
                }
                Text(
                    "公开仓库不需要令牌。私有仓库建议使用 fine-grained token，仅授予 Metadata: read 与 Contents: read。令牌由 Android Keystore 加密保存。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(onClick = onTokenHelp, modifier = Modifier.align(Alignment.End)) {
                    Text("创建只读令牌")
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(15.dp))
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        Text(
            "从手机项目库移除项目不会删除 GitHub 仓库。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun RepositoryListScreen(
    state: ViewerUiState,
    onQueryChange: (String) -> Unit,
    onOpen: (GitHubRepository) -> Unit,
    onDownload: (GitHubRepository) -> Unit,
    onAdd: () -> Unit,
    onRemove: (GitHubRepository) -> Unit,
    onOpenSettings: () -> Unit
) {
    val query = state.repositoryQuery.trim()
    val filtered = remember(state.repositories, query) {
        state.repositories.filter {
            query.isEmpty() || it.fullName.contains(query, ignoreCase = true) ||
                it.description.orEmpty().contains(query, ignoreCase = true)
        }
    }
    val listState = rememberLazyListState()
    var removeCandidate by remember { mutableStateOf<GitHubRepository?>(null) }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("项目库", style = MaterialTheme.typography.headlineSmall)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "${state.repositories.size} 个项目 · 保存在这台手机",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                OutlinedButton(onClick = onAdd, shape = RoundedCornerShape(12.dp)) {
                    Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("添加")
                }
            }
        }
        item {
            SearchField(
                value = state.repositoryQuery,
                onValueChange = onQueryChange,
                placeholder = "搜索项目"
            )
        }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceVariant
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text("默认下载位置", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "内部存储/Download/LaTeX项目",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        }
        if (state.updateAvailable) {
            item {
                Surface(
                    onClick = onOpenSettings,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Outlined.SystemUpdateAlt, contentDescription = null)
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Android ${state.updateInfo?.version.orEmpty()} 可用", fontWeight = FontWeight.SemiBold)
                            Text(
                                if (state.downloadedApkPath != null) "更新包已下载，点击安装" else "点击查看并下载更新",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        Icon(Icons.Outlined.ChevronRight, contentDescription = null)
                    }
                }
            }
        }
        if (filtered.isEmpty()) {
            item {
                EmptyState(
                    if (state.repositories.isEmpty()) "还没有项目" else "没有匹配的项目",
                    if (state.repositories.isEmpty()) "点击“添加”，输入 GitHub 仓库地址。" else "请更换搜索关键词。"
                )
            }
        } else {
            items(filtered, key = { it.fullName }) { repository ->
                RepositoryCard(
                    repository,
                    onClick = { onOpen(repository) },
                    onDownload = { onDownload(repository) },
                    onRemove = { removeCandidate = repository }
                )
            }
        }
        item { ReadOnlyFooter() }
    }

    removeCandidate?.let { repository ->
        AlertDialog(
            onDismissRequest = { removeCandidate = null },
            icon = { Icon(Icons.Outlined.DeleteOutline, contentDescription = null) },
            title = { Text("从手机移除项目？") },
            text = { Text("将移除 ${repository.fullName} 的本机入口，不会删除或修改 GitHub 仓库。") },
            confirmButton = {
                TextButton(onClick = {
                    removeCandidate = null
                    onRemove(repository)
                }) { Text("移除") }
            },
            dismissButton = {
                TextButton(onClick = { removeCandidate = null }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun RepositoryCard(
    repository: GitHubRepository,
    onClick: () -> Unit,
    onDownload: () -> Unit,
    onRemove: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(46.dp),
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceVariant
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Folder, contentDescription = null, modifier = Modifier.size(23.dp))
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        repository.name,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    Spacer(Modifier.width(8.dp))
                    PrivacyPill(repository.isPrivate)
                }
                Text(
                    repository.owner,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
                repository.description?.let {
                    Spacer(Modifier.height(5.dp))
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "${formatBytes(repository.sizeKb * 1024)} · 更新于 ${shortDate(repository.updatedAt)}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = onDownload) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = "下载 ${repository.name} 整个项目 ZIP",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            IconButton(onClick = onRemove) {
                Icon(
                    Icons.Outlined.DeleteOutline,
                    contentDescription = "从手机移除 ${repository.name}",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FileListScreen(
    state: ViewerUiState,
    onQueryChange: (String) -> Unit,
    onOpen: (GitHubContent) -> Unit,
    onDownloadFile: (GitHubContent) -> Unit,
    onDownloadProject: (GitHubRepository) -> Unit
) {
    val repository = state.currentRepository ?: return
    val query = state.fileQuery.trim()
    val filtered = remember(state.contents, query) {
        state.contents.filter { query.isEmpty() || it.name.contains(query, ignoreCase = true) }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            RepositorySummary(
                repository,
                state.currentPath,
                onDownloadProject = { onDownloadProject(repository) }
            )
        }
        item {
            SearchField(value = state.fileQuery, onValueChange = onQueryChange, placeholder = "搜索当前文件夹")
        }
        if (filtered.isEmpty()) {
            item { EmptyState("这里没有文件", if (query.isEmpty()) "这个目录为空。" else "没有匹配的文件。") }
        } else {
            items(filtered, key = { it.path }) { item ->
                FileRow(
                    item,
                    onClick = { onOpen(item) },
                    onDownload = if (item.kind == GitHubContentKind.FILE) {
                        { onDownloadFile(item) }
                    } else null
                )
            }
        }
        item { ReadOnlyFooter() }
    }
}

@Composable
private fun RepositorySummary(
    repository: GitHubRepository,
    path: String,
    onDownloadProject: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.FolderOpen, contentDescription = null, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(repository.fullName, style = MaterialTheme.typography.titleMedium)
                    Text("分支 ${repository.defaultBranch}", style = MaterialTheme.typography.bodyMedium)
                }
                PrivacyPill(repository.isPrivate)
            }
            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.15f))
            Spacer(Modifier.height(12.dp))
            Text(
                if (path.isEmpty()) "项目根目录" else path,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = onDownloadProject,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("下载整个 LaTeX 项目（ZIP）")
            }
        }
    }
}

@Composable
private fun FileRow(item: GitHubContent, onClick: () -> Unit, onDownload: (() -> Unit)?) {
    val isFolder = item.kind == GitHubContentKind.DIRECTORY
    val isText = item.kind == GitHubContentKind.FILE && isLikelyText(item.name)
    val isPdf = item.kind == GitHubContentKind.FILE && ViewerViewModel.isPdfFile(item.name)
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(40.dp),
                shape = RoundedCornerShape(12.dp),
                color = if (isFolder) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        when {
                            isFolder -> Icons.Outlined.Folder
                            isPdf -> Icons.Outlined.PictureAsPdf
                            isText -> Icons.Outlined.Code
                            else -> Icons.Outlined.Description
                        },
                        contentDescription = null,
                        tint = if (isFolder) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(21.dp)
                    )
                }
            }
            Spacer(Modifier.width(13.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(item.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    when {
                        isFolder -> "文件夹"
                        isPdf -> "${formatBytes(item.size)} · 内置 PDF 查看器"
                        isText && item.size <= 1_500_000 -> "${formatBytes(item.size)} · 可直接阅读"
                        else -> "${formatBytes(item.size)} · 在 GitHub 中查看"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (onDownload != null) {
                IconButton(onClick = onDownload) {
                    Icon(
                        Icons.Outlined.Download,
                        contentDescription = "下载 ${item.name}",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Icon(
                if (isFolder || isText || isPdf) Icons.Outlined.ChevronRight else Icons.Outlined.OpenInNew,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(19.dp)
            )
        }
    }
}

@Composable
private fun TextPreviewScreen(state: ViewerUiState, onDownload: (GitHubContent) -> Unit) {
    val document = state.document ?: return
    val sourceItem = state.contents.firstOrNull { it.path == document.path }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Outlined.Article, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(document.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        document.path,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Text(
                        "代码 · 只读",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        style = MaterialTheme.typography.labelLarge
                    )
                }
                if (sourceItem != null) {
                    Spacer(Modifier.width(4.dp))
                    IconButton(onClick = { onDownload(sourceItem) }) {
                        Icon(Icons.Outlined.Download, contentDescription = "下载 ${document.name}")
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
            val vertical = rememberScrollState()
            val horizontal = rememberScrollState()
            SelectionContainer {
                Text(
                    text = document.content,
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(vertical)
                        .horizontalScroll(horizontal)
                        .padding(18.dp),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    lineHeight = 20.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                    softWrap = false
                )
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    state: ViewerUiState,
    onAutoCheckChange: (Boolean) -> Unit,
    onAutoDownloadChange: (Boolean) -> Unit,
    onCheck: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onOpenRelease: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Column(modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp)) {
                Text("设置与更新", style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(4.dp))
                Text(
                    "自动从公开的 GitHub Release 检查 Android 新版本。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
            ) {
                SettingSwitchRow(
                    title = "自动检查更新",
                    detail = "每次打开应用时检查 GitHub Release",
                    checked = state.autoCheckUpdates,
                    onCheckedChange = onAutoCheckChange
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingSwitchRow(
                    title = "发现新版后自动下载",
                    detail = "下载完成后仍需你确认 Android 安装界面",
                    checked = state.autoDownloadUpdates,
                    onCheckedChange = onAutoDownloadChange
                )
            }
        }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            modifier = Modifier.size(46.dp),
                            shape = RoundedCornerShape(14.dp),
                            color = MaterialTheme.colorScheme.primaryContainer
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Outlined.SystemUpdateAlt,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.secondary
                                )
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Android 客户端", style = MaterialTheme.typography.titleMedium)
                            Text(
                                "当前 ${state.currentVersion}" +
                                    (state.updateInfo?.let { " · 最新 ${it.version}" } ?: ""),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    Text(
                        state.updateMessage,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (state.updateAvailable) MaterialTheme.colorScheme.secondary
                        else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    state.updateInfo?.takeIf { state.updateAvailable }?.let { release ->
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(release.name, fontWeight = FontWeight.Medium)
                                Text(
                                    "${formatBytes(release.size)} · ${release.releaseTag}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                    if (state.updateAvailable) {
                        Button(
                            onClick = if (state.downloadedApkPath == null) onDownloadUpdate else onInstallUpdate,
                            enabled = state.transfer == null,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(50.dp),
                            shape = RoundedCornerShape(13.dp)
                        ) {
                            Icon(
                                if (state.downloadedApkPath == null) Icons.Outlined.Download else Icons.Outlined.SystemUpdateAlt,
                                contentDescription = null,
                                modifier = Modifier.size(19.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(if (state.downloadedApkPath == null) "下载更新" else "安装更新")
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = onCheck,
                            enabled = !state.updateChecking && state.transfer == null,
                            modifier = Modifier.weight(1f)
                        ) {
                            if (state.updateChecking) {
                                CircularProgressIndicator(modifier = Modifier.size(17.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(17.dp))
                            }
                            Spacer(Modifier.width(6.dp))
                            Text("立即检查")
                        }
                        OutlinedButton(onClick = onOpenRelease, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Release")
                        }
                    }
                }
            }
        }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceVariant
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.Download, contentDescription = null)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("文件默认下载位置", fontWeight = FontWeight.SemiBold)
                        Text(
                            "内部存储/Download/LaTeX项目",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
        item {
            Text(
                "APK 下载后会进行文件大小和 SHA-256 校验。Android 系统仍会要求你确认安装；应用不能绕过系统安全提示。",
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun SettingSwitchRow(
    title: String,
    detail: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.padding(horizontal = 18.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(2.dp))
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(14.dp))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun DownloadCompleteDialog(
    download: DownloadedFile,
    onOpen: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary
            )
        },
        title = { Text("下载完成") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(download.name, fontWeight = FontWeight.SemiBold)
                Text(
                    "已保存到：",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant
                ) {
                    SelectionContainer {
                        Text(
                            download.displayPath,
                            modifier = Modifier.padding(12.dp),
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
                Text("是否现在打开？", style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = {
            Button(onClick = onOpen) {
                Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(6.dp))
                Text("现在打开")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("稍后") }
        }
    )
}

@Composable
private fun TransferCard(transfer: TransferUiState, modifier: Modifier = Modifier) {
    val determinate = transfer.total > 0
    val progress = if (determinate) {
        (transfer.downloaded.toFloat() / transfer.total.toFloat()).coerceIn(0f, 1f)
    } else 0f
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
        shadowElevation = 8.dp
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Text(transfer.label, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(8.dp))
            if (determinate) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.secondary
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "${formatBytes(transfer.downloaded)} / ${formatBytes(transfer.total)}",
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.secondary)
                Spacer(Modifier.height(6.dp))
                Text(formatBytes(transfer.downloaded), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun SearchField(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = if (value.isNotEmpty()) {
            {
                IconButton(onClick = { onValueChange("") }) {
                    Icon(Icons.Outlined.Clear, contentDescription = "清除搜索")
                }
            }
        } else null,
        singleLine = true,
        shape = RoundedCornerShape(14.dp)
    )
}

@Composable
private fun PrivacyPill(isPrivate: Boolean) {
    val background = if (isPrivate) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.primaryContainer
    val foreground = if (isPrivate) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onPrimaryContainer
    Surface(shape = RoundedCornerShape(999.dp), color = background, contentColor = foreground) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (isPrivate) Icons.Outlined.Lock else Icons.Outlined.Public,
                contentDescription = null,
                modifier = Modifier.size(12.dp)
            )
            Spacer(Modifier.width(4.dp))
            Text(if (isPrivate) "私有" else "公开", style = MaterialTheme.typography.bodyMedium, fontSize = 12.sp)
        }
    }
}

@Composable
private fun EmptyState(title: String, detail: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 52.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
            Box(modifier = Modifier.size(54.dp), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.FolderOpen, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(5.dp))
        Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ReadOnlyFooter() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 22.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.Lock, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(6.dp))
        Text("只读浏览，不会修改 GitHub 文件", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = -1
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit += 1
    }
    return if (value >= 10) "%.0f %s".format(value, units[unit]) else "%.1f %s".format(value, units[unit])
}

private fun shortDate(iso: String): String = iso.take(10).ifBlank { "未知日期" }

private fun isLikelyText(name: String): Boolean {
    val lower = name.lowercase()
    if (lower in setOf("readme", "license", "makefile", "latexmkrc", ".gitignore", ".gitattributes")) return true
    return lower.substringAfterLast('.', "") in setOf(
        "tex", "bib", "cls", "sty", "bst", "bbx", "cbx", "lbx", "dtx", "ins", "md", "mdx", "txt",
        "rst", "adoc", "json", "jsonc", "yaml", "yml", "toml", "xml", "csv", "tsv", "ini", "cfg",
        "conf", "properties", "gradle", "kts", "kt", "java", "c", "h", "cpp", "hpp", "py", "r",
        "m", "js", "jsx", "ts", "tsx", "css", "scss", "html", "htm", "sh", "ps1", "bat", "cmd", "sql", "log"
    )
}
