package com.zqy.latexviewer.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.SystemUpdateAlt
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.DownloadHistoryKind
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.ui.theme.LaTeXViewerTheme
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.rememberHazeState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LaTeXViewerApp(viewModel: ViewerViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val homeListState = rememberLazyListState()
    val projectListState = rememberLazyListState()
    val downloadListState = rememberLazyListState()
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current
    val apkInstaller = remember(context) { ApkInstaller(context.applicationContext) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    var askedForDownloadNotifications by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(state.transfer?.workId) {
        if (state.transfer != null && !askedForDownloadNotifications &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            askedForDownloadNotifications = true
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

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

    BackHandler(enabled = state.screen !in setOf(ViewerScreen.HOME, ViewerScreen.REPOSITORIES, ViewerScreen.DOWNLOADS)) { viewModel.goBack() }

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

    LaunchedEffect(state.shareFile) {
        state.shareFile?.let { file ->
            val uri = Uri.parse(file.contentUri)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = file.mimeType.ifBlank { "application/octet-stream" }
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newUri(context.contentResolver, file.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runCatching {
                context.startActivity(Intent.createChooser(intent, "分享 ${file.name}"))
            }.onFailure { failure ->
                val message = if (failure is ActivityNotFoundException) {
                    "手机上没有可接收这种文件的应用"
                } else {
                    failure.message ?: "无法分享这个文件"
                }
                viewModel.showError(message)
            }
            viewModel.consumeShareFile()
        }
    }

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearNotice()
        }
    }

    LaTeXViewerTheme {
        val colors = MaterialTheme.colorScheme
        val hazeState = rememberHazeState()
        val ambientBackground = Brush.verticalGradient(
            colors = listOf(
                colors.primaryContainer.copy(alpha = 0.42f),
                colors.background,
                colors.background,
                colors.tertiaryContainer.copy(alpha = 0.18f)
            )
        )
        Box(
            modifier = Modifier.fillMaxSize()
        ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(ambientBackground)
                .liquidGlassSource(hazeState)
        )
        Scaffold(
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets.safeDrawing,
            snackbarHost = { SnackbarHost(snackbarHostState) },
            topBar = {
                if (state.screen != ViewerScreen.PDF) {
                    ViewerTopBar(
                        state = state,
                        onBack = viewModel::goBack,
                        onAddProject = viewModel::openAddProject,
                        onRefresh = viewModel::refresh,
                        onOpenGitHub = viewModel::openCurrentOnGitHub,
                        onOpenSettings = viewModel::openSettings,
                        hazeState = hazeState,
                        onDownloadProject = {
                            state.currentRepository?.let(viewModel::downloadRepository)
                        }
                    )
                }
            },
            bottomBar = {
                if (state.screen in setOf(ViewerScreen.HOME, ViewerScreen.REPOSITORIES, ViewerScreen.DOWNLOADS)) {
                    ViewerBottomBar(
                        screen = state.screen,
                        transferActive = state.transfer != null,
                        hazeState = hazeState,
                        onHome = viewModel::openHome,
                        onProjects = viewModel::openProjects,
                        onDownloads = viewModel::openDownloads
                    )
                }
            }
        ) { contentPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(contentPadding)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .liquidGlassSource(hazeState)
                ) {
                    when (state.screen) {
                    ViewerScreen.HOME -> HomeScreen(
                        state = state,
                        listState = homeListState,
                        onOpenMobilePdf = viewModel::openMobilePdf,
                        onOpenProjects = viewModel::openProjects
                    )
                    ViewerScreen.CONNECT -> ConnectScreen(
                        tokenStored = state.tokenStored,
                        loading = state.loading,
                        onConnect = viewModel::connect,
                        onTokenHelp = { uriHandler.openUri("https://github.com/settings/personal-access-tokens/new") }
                    )
                    ViewerScreen.REPOSITORIES -> RepositoryListScreen(
                        state = state,
                        listState = projectListState,
                        onQueryChange = viewModel::updateRepositoryQuery,
                        onOpen = viewModel::openRepository,
                        onDownload = viewModel::downloadRepository,
                        onAdd = viewModel::openAddProject,
                        onRemove = viewModel::removeRepository
                    )
                    ViewerScreen.DOWNLOADS -> DownloadsScreen(
                        state = state,
                        listState = downloadListState,
                        onOpen = viewModel::openDownloaded,
                        onShare = viewModel::shareDownloaded,
                        onRemove = viewModel::removeDownloadRecord,
                        onClearHistory = viewModel::clearDownloadHistory,
                        onCancelTransfer = viewModel::cancelTransfer
                    )
                    ViewerScreen.FILES -> FileListScreen(
                        state = state,
                        onQueryChange = viewModel::updateFileQuery,
                        onOpen = viewModel::openContent,
                        onDownloadFile = viewModel::downloadFile
                    )
                    ViewerScreen.TEXT -> TextPreviewScreen(
                        state,
                        onDownload = viewModel::downloadFile
                    )
                    ViewerScreen.PDF -> PdfPreviewScreen(
                        state,
                        onBack = viewModel::goBack,
                        onOpenGitHub = viewModel::openCurrentOnGitHub,
                        onDownload = viewModel::downloadFile,
                        onRetry = viewModel::retryCurrentPdf,
                        onOpenExternal = viewModel::openCurrentPdfExternally,
                        onPageChanged = viewModel::recordPdfPage
                    )
                    ViewerScreen.SETTINGS -> SettingsScreen(
                        state = state,
                        onAutoCheckChange = viewModel::setAutoCheckUpdates,
                        onAutoDownloadChange = viewModel::setAutoDownloadUpdates,
                        onCheck = { viewModel.checkForUpdates() },
                        onDownloadUpdate = viewModel::downloadUpdate,
                        onInstallUpdate = ::installDownloadedUpdate,
                        onOpenRelease = viewModel::openReleasePage,
                        onClearPdfCache = viewModel::clearPdfCache,
                        onDisconnect = viewModel::disconnect
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
                }
                state.transfer?.takeIf { state.transferPanelVisible && state.screen != ViewerScreen.DOWNLOADS }?.let { transfer ->
                    TransferCard(
                        transfer,
                        onCancel = viewModel::cancelTransfer,
                        onHide = viewModel::hideTransferPanel,
                        onOpenDownloads = viewModel::openDownloads,
                        hazeState = hazeState,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp)
                    )
                }
                state.completedDownload
                    ?.takeIf {
                        state.screen != ViewerScreen.DOWNLOADS &&
                            (state.transfer == null || !state.transferPanelVisible)
                    }
                    ?.let { download ->
                    DownloadCompleteBanner(
                        download = download,
                        onOpen = viewModel::openCompletedDownload,
                        onDismiss = viewModel::dismissCompletedDownload,
                        hazeState = hazeState,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp)
                    )
                }
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
    onOpenSettings: () -> Unit,
    hazeState: HazeState,
    onDownloadProject: () -> Unit
) {
    var projectMenuExpanded by remember { mutableStateOf(false) }
    var documentMenuExpanded by remember { mutableStateOf(false) }
    val title = when (state.screen) {
        ViewerScreen.HOME -> "阅读"
        ViewerScreen.REPOSITORIES -> "项目"
        ViewerScreen.DOWNLOADS -> "下载"
        ViewerScreen.FILES -> state.currentRepository?.name ?: "项目文件"
        ViewerScreen.TEXT -> state.document?.name ?: "代码查看器"
        ViewerScreen.PDF -> state.pdfDocument?.name ?: "PDF 查看器"
        ViewerScreen.SETTINGS -> "设置"
        ViewerScreen.CONNECT -> "添加项目"
    }
    val isRootScreen = state.screen in setOf(
        ViewerScreen.HOME,
        ViewerScreen.REPOSITORIES,
        ViewerScreen.DOWNLOADS
    )

    LiquidGlassTopBar(
        title = title,
        modifier = Modifier
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 6.dp),
        navigationIcon = if (isRootScreen) null else Icons.AutoMirrored.Outlined.ArrowBack,
        onNavigationClick = if (isRootScreen) null else onBack,
        hazeState = hazeState
    ) {
        if (isRootScreen) {
            if (state.screen == ViewerScreen.REPOSITORIES) {
                IconButton(onClick = onAddProject) {
                    Icon(Icons.Outlined.Add, contentDescription = "添加项目")
                }
            }
            if (state.screen == ViewerScreen.HOME) {
                IconButton(onClick = onRefresh, enabled = !state.loading) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新文档")
                }
            }
            IconButton(onClick = onOpenSettings) {
                Box(modifier = Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.Settings,
                        contentDescription = if (state.updateAvailable) "打开设置，有新版本可用" else "打开设置"
                    )
                    if (state.updateAvailable) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .size(7.dp)
                                .background(MaterialTheme.colorScheme.secondary, CircleShape)
                        )
                    }
                }
            }
        } else {
            if (state.screen == ViewerScreen.FILES) {
                Box {
                    IconButton(onClick = { projectMenuExpanded = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "项目文件选项")
                    }
                    DropdownMenu(
                        expanded = projectMenuExpanded,
                        onDismissRequest = { projectMenuExpanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("下载项目 ZIP") },
                            leadingIcon = { Icon(Icons.Outlined.Download, contentDescription = null) },
                            onClick = {
                                projectMenuExpanded = false
                                onDownloadProject()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("在 GitHub 中打开") },
                            leadingIcon = { Icon(Icons.Outlined.OpenInNew, contentDescription = null) },
                            onClick = {
                                projectMenuExpanded = false
                                onOpenGitHub()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("刷新文件") },
                            leadingIcon = { Icon(Icons.Outlined.Refresh, contentDescription = null) },
                            onClick = {
                                projectMenuExpanded = false
                                onRefresh()
                            }
                        )
                    }
                }
            }
            if (state.screen == ViewerScreen.TEXT) {
                Box {
                    IconButton(onClick = { documentMenuExpanded = true }) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "文档选项")
                    }
                    DropdownMenu(
                        expanded = documentMenuExpanded,
                        onDismissRequest = { documentMenuExpanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("在 GitHub 中打开") },
                            leadingIcon = { Icon(Icons.Outlined.OpenInNew, contentDescription = null) },
                            onClick = {
                                documentMenuExpanded = false
                                onOpenGitHub()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("重新载入") },
                            leadingIcon = { Icon(Icons.Outlined.Refresh, contentDescription = null) },
                            enabled = !state.loading,
                            onClick = {
                                documentMenuExpanded = false
                                onRefresh()
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ViewerBottomBar(
    screen: ViewerScreen,
    transferActive: Boolean,
    hazeState: HazeState,
    onHome: () -> Unit,
    onProjects: () -> Unit,
    onDownloads: () -> Unit
) {
    LiquidGlassBottomBar(
        selected = screen,
        downloadActive = transferActive,
        onHome = onHome,
        onProjects = onProjects,
        onDownloads = onDownloads,
        hazeState = hazeState
    )
}

@Composable
private fun ConnectScreen(
    tokenStored: Boolean,
    loading: Boolean,
    onConnect: (String, String) -> Unit,
    onTokenHelp: () -> Unit
) {
    var repository by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf("") }
    var showToken by rememberSaveable { mutableStateOf(false) }
    var showPrivateOptions by rememberSaveable { mutableStateOf(tokenStored) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.Start
    ) {
        Text(
            "粘贴 GitHub 仓库地址。添加后，项目会保存在这台手机的只读项目库中。",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(24.dp))
        PaperSectionHeader("仓库")

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedTextField(
                value = repository,
                onValueChange = { repository = it },
                label = { Text("GitHub 仓库地址") },
                placeholder = { Text("owner/repository 或完整网址") },
                leadingIcon = { Icon(Icons.Outlined.CloudQueue, contentDescription = null) },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            if (showPrivateOptions) {
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    label = { Text("私有仓库只读令牌") },
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
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                TextButton(onClick = onTokenHelp, modifier = Modifier.align(Alignment.Start)) {
                    Text("创建只读令牌")
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(15.dp))
                }
            } else {
                TextButton(onClick = { showPrivateOptions = true }, modifier = Modifier.align(Alignment.Start)) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("这是私有仓库")
                }
            }
            Button(
                onClick = { onConnect(token, repository) },
                enabled = !loading && (repository.isNotBlank() || token.isNotBlank() || tokenStored),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                shape = RoundedCornerShape(12.dp),
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
        }

        Spacer(Modifier.height(28.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top
        ) {
            Icon(
                Icons.Outlined.Lock,
                contentDescription = null,
                modifier = Modifier.size(17.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.width(9.dp))
            Text(
                "应用只读取项目。私有令牌由 Android Keystore 加密保存；从手机移除项目不会删除 GitHub 仓库。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun HomeScreen(
    state: ViewerUiState,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onOpenMobilePdf: (GitHubRepository, MobilePdfOutput) -> Unit,
    onOpenProjects: () -> Unit
) {
    val latestPdfs = remember(state.repositories, state.mobileIndexes) {
        state.repositories
            .sortedByDescending(GitHubRepository::updatedAt)
            .mapNotNull { repository ->
                state.mobileIndexes[repository.fullName.lowercase()]?.defaultOutput?.let { repository to it }
            }
    }
    val continueReading = remember(state.recentReading, latestPdfs) {
        val progress = state.recentReading ?: return@remember null
        latestPdfs.firstOrNull { (repository, output) ->
            repository.fullName.equals(progress.repositoryFullName, ignoreCase = true) && output.pdfPath == progress.pdfPath
        }
    }
    val recentPdfs = remember(latestPdfs, continueReading) {
        latestPdfs.filterNot { candidate -> candidate == continueReading }.take(3)
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = 4.dp,
            bottom = 32.dp
        ),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item { PaperSectionHeader(if (continueReading != null) "继续阅读" else "开始阅读") }
        if (continueReading != null) {
            val (repository, output) = continueReading
            item {
                MobilePdfHomeCard(
                    repository = repository,
                    output = output,
                    progress = state.recentReading?.let { "第 ${it.pageIndex + 1} / ${it.pageCount} 页" },
                    progressFraction = state.recentReading?.let {
                        if (it.pageCount > 0) ((it.pageIndex + 1f) / it.pageCount).coerceIn(0f, 1f) else null
                    },
                    emphasized = true,
                    onOpen = { onOpenMobilePdf(repository, output) }
                )
            }
        } else if (latestPdfs.isNotEmpty()) {
            val (repository, output) = latestPdfs.first()
            item {
                MobilePdfHomeCard(
                    repository = repository,
                    output = output,
                    progress = "首次打开",
                    progressFraction = 0f,
                    emphasized = true,
                    onOpen = { onOpenMobilePdf(repository, output) }
                )
            }
        } else {
            item {
                PaperEmptyState(
                    title = "还没有可阅读的 PDF",
                    detail = "在桌面端为项目指定主 PDF 后，就可以从这里继续阅读。",
                    icon = Icons.Outlined.PictureAsPdf,
                    actionLabel = "查看项目",
                    onAction = onOpenProjects
                )
            }
        }
        if (recentPdfs.isNotEmpty()) {
            item { PaperSectionHeader("最近更新", modifier = Modifier.padding(top = 18.dp)) }
            itemsIndexed(
                recentPdfs,
                key = { _, (repository, output) -> "home:${repository.fullName}:${output.id}" }
            ) { index, (repository, output) ->
                MobilePdfHomeCard(
                    repository = repository,
                    output = output,
                    progress = null,
                    progressFraction = null,
                    emphasized = false,
                    onOpen = { onOpenMobilePdf(repository, output) }
                )
                if (index != recentPdfs.lastIndex) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 36.dp),
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DownloadsScreen(
    state: ViewerUiState,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onOpen: (DownloadedFile) -> Unit,
    onShare: (DownloadedFile) -> Unit,
    onRemove: (DownloadedFile) -> Unit,
    onClearHistory: () -> Unit,
    onCancelTransfer: () -> Unit
) {
    var filterName by rememberSaveable { mutableStateOf(DownloadHistoryFilter.ALL.name) }
    var detailDownload by remember { mutableStateOf<DownloadedFile?>(null) }
    var showHeaderMenu by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    val filter = runCatching { DownloadHistoryFilter.valueOf(filterName) }
        .getOrDefault(DownloadHistoryFilter.ALL)
    val filteredDownloads = state.downloadedFiles.filter(filter::accepts)
    val totalBytes = state.downloadedFiles.sumOf { it.size.coerceAtLeast(0) }

    detailDownload?.let { download ->
        val available = state.downloadAvailability[download.stableId] != false
        ModalBottomSheet(
            onDismissRequest = { detailDownload = null },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 20.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        modifier = Modifier.size(48.dp),
                        shape = RoundedCornerShape(14.dp),
                        color = if (available) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.errorContainer
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                downloadHistoryIcon(download.kind),
                                contentDescription = null,
                                tint = if (available) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error
                            )
                        }
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            download.name,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            "${downloadHistoryKindLabel(download.kind)} · ${formatBytes(download.size)}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    download.sourceRepository?.let { DownloadDetailLine("来源项目", it) }
                    download.sourcePath?.let { DownloadDetailLine("源文件", it) }
                    DownloadDetailLine("下载时间", formatDownloadTime(download.downloadedAt))
                    DownloadDetailLine("保存位置", download.displayPath)
                }
                if (!available) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer
                    ) {
                        Text(
                            "文件已经被移动、删除或缓存已清理。你可以移除这条历史记录。",
                            modifier = Modifier.padding(14.dp),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
                if (available) {
                    Button(
                        onClick = {
                            detailDownload = null
                            onOpen(download)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        Text("打开文件")
                    }
                    OutlinedButton(
                        onClick = {
                            detailDownload = null
                            onShare(download)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        Icon(Icons.Outlined.Share, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("分享到微信、WPS 等应用")
                    }
                }
                TextButton(
                    onClick = {
                        detailDownload = null
                        onRemove(download)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("移除历史记录", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("清空下载历史？") },
            text = { Text("只会清空客户端中的历史记录，不会删除已经下载到手机的 ZIP、PDF、源码或 APK。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmClear = false
                    onClearHistory()
                }) { Text("清空记录", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("取消") } }
        )
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = 4.dp,
            bottom = 32.dp
        ),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        state.transfer?.let { transfer ->
            item {
                TransferCard(transfer, onCancelTransfer)
                Spacer(Modifier.height(20.dp))
            }
        }
        if (state.downloadedFiles.isNotEmpty()) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    DownloadHistoryFilter.entries.filter { option ->
                        option == DownloadHistoryFilter.ALL || state.downloadedFiles.any(option::accepts)
                    }.forEach { option ->
                        TextButton(onClick = { filterName = option.name }) {
                            Text(
                                option.label,
                                color = if (filter == option) {
                                    MaterialTheme.colorScheme.onSurface
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                                fontWeight = if (filter == option) FontWeight.SemiBold else FontWeight.Normal
                            )
                        }
                    }
                    Box {
                        IconButton(
                            enabled = state.downloadedFiles.isNotEmpty(),
                            onClick = { showHeaderMenu = true }
                        ) { Icon(Icons.Outlined.MoreVert, contentDescription = "下载历史选项") }
                        DropdownMenu(expanded = showHeaderMenu, onDismissRequest = { showHeaderMenu = false }) {
                            DropdownMenuItem(
                                text = { Text("清空历史记录") },
                                onClick = {
                                    showHeaderMenu = false
                                    confirmClear = true
                                }
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
        if (state.downloadedFiles.isEmpty()) {
            item {
                PaperEmptyState(
                    title = "还没有下载记录",
                    detail = "下载项目、PDF 或源码后，可以在这里打开和分享。",
                    icon = Icons.Outlined.Download
                )
            }
        } else if (filteredDownloads.isEmpty()) {
            item {
                PaperEmptyState(
                    title = "这个分类还没有文件",
                    detail = "切换到“全部”查看其他下载记录。",
                    icon = Icons.Outlined.Search
                )
            }
        } else {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PaperSectionHeader("下载历史", modifier = Modifier.weight(1f))
                    Text(
                        "${state.downloadedFiles.size} 项 · ${formatBytes(totalBytes)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            itemsIndexed(filteredDownloads, key = { _, download -> download.stableId }) { index, download ->
                val available = state.downloadAvailability[download.stableId] != false
                Surface(
                    onClick = {
                        if (available) onOpen(download) else detailDownload = download
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(0.dp),
                    color = Color.Transparent
                ) {
                    Row(modifier = Modifier.padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                        PaperFileTypeIcon(
                            type = when (download.kind) {
                                DownloadHistoryKind.PROJECT_ARCHIVE -> PaperFileType.ARCHIVE
                                DownloadHistoryKind.PDF -> PaperFileType.PDF
                                DownloadHistoryKind.SOURCE_FILE -> PaperFileType.SOURCE
                                DownloadHistoryKind.APP_PACKAGE -> PaperFileType.APP
                                DownloadHistoryKind.OTHER -> PaperFileType.FILE
                            },
                            size = 23.dp,
                            tint = if (available) null else MaterialTheme.colorScheme.error
                        )
                        Spacer(Modifier.width(13.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                download.name,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                if (available) {
                                    "${downloadHistoryKindLabel(download.kind)} · ${formatBytes(download.size)} · ${formatDownloadTime(download.downloadedAt)}"
                                } else {
                                    "文件已不可用 · 仅保留历史记录"
                                },
                                color = if (available) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        IconButton(enabled = available, onClick = { onShare(download) }) {
                            Icon(Icons.Outlined.Share, contentDescription = "分享 ${download.name}")
                        }
                    }
                }
                if (index != filteredDownloads.lastIndex) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 36.dp),
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun DownloadDetailLine(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private enum class DownloadHistoryFilter(val label: String) {
    ALL("全部"),
    PDF("PDF"),
    PROJECT("项目"),
    FILE("文件"),
    APP("安装包");

    fun accepts(download: DownloadedFile): Boolean = when (this) {
        ALL -> true
        PDF -> download.kind == DownloadHistoryKind.PDF
        PROJECT -> download.kind == DownloadHistoryKind.PROJECT_ARCHIVE
        FILE -> download.kind in setOf(DownloadHistoryKind.SOURCE_FILE, DownloadHistoryKind.OTHER)
        APP -> download.kind == DownloadHistoryKind.APP_PACKAGE
    }
}

@Composable
private fun RepositoryListScreen(
    state: ViewerUiState,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onQueryChange: (String) -> Unit,
    onOpen: (GitHubRepository) -> Unit,
    onDownload: (GitHubRepository) -> Unit,
    onAdd: () -> Unit,
    onRemove: (GitHubRepository) -> Unit
) {
    val query = state.repositoryQuery.trim()
    val filtered = remember(state.repositories, query) {
        state.repositories.filter {
            query.isEmpty() || it.fullName.contains(query, ignoreCase = true) ||
                it.description.orEmpty().contains(query, ignoreCase = true)
        }
    }
    var removeCandidate by remember { mutableStateOf<GitHubRepository?>(null) }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = 4.dp,
            bottom = 32.dp
        ),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item {
            Column {
                PaperSearchField(
                    value = state.repositoryQuery,
                    onValueChange = onQueryChange,
                    placeholder = "搜索项目"
                )
                Spacer(Modifier.height(16.dp))
            }
        }
        if (filtered.isEmpty()) {
            item {
                PaperEmptyState(
                    title = if (state.repositories.isEmpty()) "还没有项目" else "没有匹配的项目",
                    detail = if (state.repositories.isEmpty()) "添加 GitHub 仓库后，就能浏览和下载项目文件。" else "请更换搜索关键词。",
                    icon = if (state.repositories.isEmpty()) Icons.Outlined.FolderOpen else Icons.Outlined.Search,
                    actionLabel = if (state.repositories.isEmpty()) "添加项目" else null,
                    onAction = if (state.repositories.isEmpty()) onAdd else null
                )
            }
        } else {
            itemsIndexed(filtered, key = { _, repository -> repository.fullName }) { index, repository ->
                RepositoryCard(
                    repository,
                    onClick = { onOpen(repository) },
                    onDownload = { onDownload(repository) },
                    onRemove = { removeCandidate = repository }
                )
                if (index != filtered.lastIndex) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 36.dp),
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                }
            }
        }
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
private fun MobilePdfHomeCard(
    repository: GitHubRepository,
    output: MobilePdfOutput,
    progress: String?,
    progressFraction: Float?,
    emphasized: Boolean,
    onOpen: () -> Unit
) {
    Surface(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(if (emphasized) 22.dp else 0.dp),
        color = if (emphasized) MaterialTheme.colorScheme.inverseSurface else Color.Transparent,
        contentColor = if (emphasized) MaterialTheme.colorScheme.inverseOnSurface else MaterialTheme.colorScheme.onSurface,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp
    ) {
        if (emphasized) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.PictureAsPdf,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp),
                        tint = MaterialTheme.colorScheme.secondary
                    )
                    Spacer(Modifier.width(9.dp))
                    Text(
                        stateSafeProjectName(repository),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.inverseOnSurface.copy(alpha = 0.72f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(Modifier.height(18.dp))
                Text(
                    output.name,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(16.dp))
                progressFraction?.let { value ->
                    LinearProgressIndicator(
                        progress = { value },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(3.dp),
                        color = MaterialTheme.colorScheme.secondary,
                        trackColor = MaterialTheme.colorScheme.inverseOnSurface.copy(alpha = 0.16f)
                    )
                    Spacer(Modifier.height(9.dp))
                }
                Text(
                    progress ?: "打开文档",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.inverseOnSurface.copy(alpha = 0.72f)
                )
            }
        } else {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                PaperFileTypeIcon(PaperFileType.PDF, size = 23.dp)
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        output.name,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        stateSafeProjectName(repository),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Icon(
                    Icons.Outlined.ChevronRight,
                    contentDescription = "打开 ${output.name}",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.65f),
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

private fun stateSafeProjectName(repository: GitHubRepository): String = repository.name

@Composable
private fun RepositoryCard(
    repository: GitHubRepository,
    onClick: () -> Unit,
    onDownload: () -> Unit,
    onRemove: () -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(0.dp),
        color = Color.Transparent,
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            PaperFileTypeIcon(PaperFileType.FOLDER, size = 25.dp)
            Spacer(Modifier.width(13.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    repository.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "${repository.owner} · ${if (repository.isPrivate) "私有" else "公开"}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Box {
                IconButton(onClick = { menuExpanded = true }) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = "${repository.name} 更多操作")
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("下载项目 ZIP") },
                        leadingIcon = { Icon(Icons.Outlined.Download, contentDescription = null) },
                        onClick = {
                            menuExpanded = false
                            onDownload()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("从手机移除") },
                        leadingIcon = { Icon(Icons.Outlined.DeleteOutline, contentDescription = null) },
                        onClick = {
                            menuExpanded = false
                            onRemove()
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun FileListScreen(
    state: ViewerUiState,
    onQueryChange: (String) -> Unit,
    onOpen: (GitHubContent) -> Unit,
    onDownloadFile: (GitHubContent) -> Unit
) {
    val repository = state.currentRepository ?: return
    val query = state.fileQuery.trim()
    val filtered = remember(state.contents, query) {
        state.contents
            .filter { query.isEmpty() || it.name.contains(query, ignoreCase = true) }
            .sortedWith(compareBy<GitHubContent> { it.kind != GitHubContentKind.DIRECTORY }.thenBy { it.name.lowercase() })
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = 4.dp,
            bottom = 32.dp
        ),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item {
            Column {
                ProjectBreadcrumb(repository.name, state.currentPath)
                Spacer(Modifier.height(8.dp))
                PaperSearchField(value = state.fileQuery, onValueChange = onQueryChange, placeholder = "搜索当前文件夹")
                Spacer(Modifier.height(14.dp))
            }
        }
        if (filtered.isEmpty()) {
            item {
                PaperEmptyState(
                    "这里没有文件",
                    if (query.isEmpty()) "这个目录为空。" else "没有匹配的文件。",
                    if (query.isEmpty()) Icons.Outlined.FolderOpen else Icons.Outlined.Search
                )
            }
        } else {
            itemsIndexed(filtered, key = { _, item -> item.path }) { index, item ->
                FileRow(
                    item = item,
                    onClick = { onOpen(item) },
                    onDownload = if (item.kind == GitHubContentKind.FILE) {
                        { onDownloadFile(item) }
                    } else null
                )
                if (index != filtered.lastIndex) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 36.dp),
                        color = MaterialTheme.colorScheme.outlineVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun ProjectBreadcrumb(projectName: String, path: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 2.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val parts = listOf(projectName) + path.split('/').filter(String::isNotBlank)
        parts.forEachIndexed { index, part ->
            if (index > 0) {
                Text("›", modifier = Modifier.padding(horizontal = 7.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                if (index == 0 && path.isEmpty()) "$part · 项目根目录" else part,
                style = MaterialTheme.typography.bodyMedium,
                color = if (index == parts.lastIndex) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = if (index == parts.lastIndex) FontWeight.Medium else FontWeight.Normal,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun FileRow(
    item: GitHubContent,
    onClick: () -> Unit,
    onDownload: (() -> Unit)?
) {
    val isFolder = item.kind == GitHubContentKind.DIRECTORY
    val isText = item.kind == GitHubContentKind.FILE && isLikelyText(item.name)
    val isPdf = item.kind == GitHubContentKind.FILE && ViewerViewModel.isPdfFile(item.name)
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(0.dp),
        color = Color.Transparent,
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            PaperFileTypeIcon(
                type = paperFileType(item.name, isFolder),
                size = 23.dp
            )
            Spacer(Modifier.width(13.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    item.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    when {
                        isFolder -> "文件夹"
                        isPdf -> "PDF · ${formatBytes(item.size)}"
                        isText -> "${item.name.substringAfterLast('.', "文本").uppercase()} · ${formatBytes(item.size)}"
                        else -> formatBytes(item.size)
                    },
                    style = MaterialTheme.typography.bodySmall,
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
        }
    }
}

@Composable
private fun TextPreviewScreen(state: ViewerUiState, onDownload: (GitHubContent) -> Unit) {
    val document = state.document ?: return
    val sourceItem = state.contents.firstOrNull { it.path == document.path }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
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
                    .padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 72.dp),
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp,
                lineHeight = 20.sp,
                color = MaterialTheme.colorScheme.onSurface,
                softWrap = false
            )
        }
        if (sourceItem != null) {
            Surface(
                onClick = { onDownload(sourceItem) },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.inverseSurface,
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                shadowElevation = 3.dp
            ) {
                Box(modifier = Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.Download,
                        contentDescription = "下载 ${document.name}",
                        modifier = Modifier.size(21.dp)
                    )
                }
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
    onOpenRelease: () -> Unit,
    onClearPdfCache: () -> Unit,
    onDisconnect: () -> Unit
) {
    var confirmDisconnect by remember { mutableStateOf(false) }

    if (confirmDisconnect) {
        AlertDialog(
            onDismissRequest = { confirmDisconnect = false },
            title = { Text("移除 GitHub 访问令牌？") },
            text = { Text("移除后，手机将无法继续打开私有仓库；公开项目和已下载文件不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDisconnect = false
                    onDisconnect()
                }) { Text("确认移除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDisconnect = false }) { Text("取消") }
            }
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = 4.dp,
            bottom = 32.dp
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item { SettingsSectionTitle("GitHub 与隐私") }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow
            ) {
                Row(
                    modifier = Modifier.padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(14.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("GitHub 访问", fontWeight = FontWeight.SemiBold)
                        Text(
                            if (state.tokenStored) "访问令牌已安全保存在本机" else "未保存令牌；只能访问公开仓库",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (state.tokenStored) {
                        TextButton(onClick = { confirmDisconnect = true }) {
                            Icon(Icons.Outlined.Logout, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(5.dp))
                            Text("移除")
                        }
                    }
                }
            }
        }
        item { SettingsSectionTitle("自动更新") }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow
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
                    onCheckedChange = onAutoDownloadChange,
                    enabled = state.autoCheckUpdates
                )
            }
        }
        item { SettingsSectionTitle("客户端版本") }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Outlined.SystemUpdateAlt,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(22.dp)
                        )
                        Spacer(Modifier.width(14.dp))
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
        item { SettingsSectionTitle("下载与阅读") }
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
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.PictureAsPdf, contentDescription = null)
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("PDF 离线缓存", fontWeight = FontWeight.SemiBold)
                        Text(
                            "已使用 ${formatBytes(state.pdfCacheBytes)} / ${formatBytes(state.pdfCacheLimitBytes)} · 按最近使用自动清理",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    TextButton(onClick = onClearPdfCache, enabled = state.pdfCacheBytes > 0 && state.transfer == null) {
                        Text("清理")
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
private fun SettingsSectionTitle(title: String) {
    PaperSectionHeader(title)
}

@Composable
private fun SettingSwitchRow(
    title: String,
    detail: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true
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
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

@Composable
private fun DownloadCompleteBanner(
    download: DownloadedFile,
    onOpen: () -> Unit,
    onDismiss: () -> Unit,
    hazeState: HazeState? = null,
    modifier: Modifier = Modifier
) {
    LiquidGlassSurface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        elevation = 8.dp,
        hazeState = hazeState
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
            Spacer(Modifier.width(11.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(download.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "已保存到 ${download.displayPath}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            TextButton(onClick = onOpen) { Text("打开") }
            IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Outlined.Clear, contentDescription = "隐藏下载完成提示", modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun TransferCard(
    transfer: TransferUiState,
    onCancel: (() -> Unit)? = null,
    onHide: (() -> Unit)? = null,
    onOpenDownloads: (() -> Unit)? = null,
    hazeState: HazeState? = null,
    modifier: Modifier = Modifier
) {
    val determinate = transfer.total > 0
    val progress = if (determinate) {
        (transfer.downloaded.toFloat() / transfer.total.toFloat()).coerceIn(0f, 1f)
    } else 0f
    LiquidGlassSurface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        elevation = 8.dp,
        hazeState = hazeState
    ) {
        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    transfer.label,
                    modifier = Modifier.weight(1f),
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (determinate) Text("${(progress * 100).toInt()}%", style = MaterialTheme.typography.bodyMedium)
                onHide?.let {
                    IconButton(onClick = it, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Outlined.ExpandMore, contentDescription = "隐藏下载进度", modifier = Modifier.size(19.dp))
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            if (determinate) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.secondary
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    buildString {
                        append("${formatBytes(transfer.downloaded)} / ${formatBytes(transfer.total)}")
                        if (transfer.bytesPerSecond > 0) append(" · ${formatBytes(transfer.bytesPerSecond)}/s")
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.secondary)
                Spacer(Modifier.height(6.dp))
                Text(
                    when {
                        transfer.waitingForNetwork -> "等待网络或系统调度；任务不会因息屏消失"
                        transfer.downloaded <= 0 -> "正在连接 GitHub…"
                        else -> buildString {
                            append("已接收 ${formatBytes(transfer.downloaded)}")
                            if (transfer.bytesPerSecond > 0) append(" · ${formatBytes(transfer.bytesPerSecond)}/s")
                        }
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            if (onCancel != null || onOpenDownloads != null) {
                Row(modifier = Modifier.align(Alignment.End)) {
                    onOpenDownloads?.let { TextButton(onClick = it) { Text("查看下载") } }
                    onCancel?.let { TextButton(onClick = it) { Text("取消") } }
                }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return if (bytes == 0L) "0 B" else "未知大小"
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

private fun downloadHistoryKindLabel(kind: DownloadHistoryKind): String = when (kind) {
    DownloadHistoryKind.PROJECT_ARCHIVE -> "项目压缩包"
    DownloadHistoryKind.PDF -> "PDF 文档"
    DownloadHistoryKind.SOURCE_FILE -> "源码文件"
    DownloadHistoryKind.APP_PACKAGE -> "Android 安装包"
    DownloadHistoryKind.OTHER -> "文件"
}

private fun downloadHistoryIcon(kind: DownloadHistoryKind): ImageVector = when (kind) {
    DownloadHistoryKind.PROJECT_ARCHIVE -> Icons.Outlined.Folder
    DownloadHistoryKind.PDF -> Icons.Outlined.PictureAsPdf
    DownloadHistoryKind.SOURCE_FILE -> Icons.Outlined.Code
    DownloadHistoryKind.APP_PACKAGE -> Icons.Outlined.SystemUpdateAlt
    DownloadHistoryKind.OTHER -> Icons.Outlined.Description
}

private fun formatDownloadTime(timestamp: Long): String {
    if (timestamp <= 0) return "旧版记录"
    val now = System.currentTimeMillis()
    val elapsed = (now - timestamp).coerceAtLeast(0)
    return when {
        elapsed < 60_000 -> "刚刚"
        elapsed < 60 * 60_000 -> "${elapsed / 60_000} 分钟前"
        elapsed < 24 * 60 * 60_000 -> "${elapsed / (60 * 60_000)} 小时前"
        elapsed < 7 * 24 * 60 * 60_000 -> "${elapsed / (24 * 60 * 60_000)} 天前"
        else -> SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
    }
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
