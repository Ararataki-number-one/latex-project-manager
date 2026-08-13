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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Sort
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.SystemUpdateAlt
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zqy.latexviewer.model.DownloadHistoryKind
import com.zqy.latexviewer.model.DownloadedFile
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import com.zqy.latexviewer.model.OfflinePdfDocument
import com.zqy.latexviewer.model.PersistentDownloadKind
import com.zqy.latexviewer.model.PersistentDownloadState
import com.zqy.latexviewer.model.PersistentDownloadTask
import com.zqy.latexviewer.model.ProjectResearchItem
import com.zqy.latexviewer.model.ReadingProgress
import com.zqy.latexviewer.model.ResearchAttachment
import com.zqy.latexviewer.ui.theme.LaTeXViewerTheme
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.rememberHazeState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

private val V8Ink = Color(0xFF111111)
private val V8Muted = Color(0xFF727272)
private val V8Line = Color(0xFFECECEA)
private val V8LineSoft = Color(0xFFF2F2F0)
private val V8Paper = Color.White
private val V8Soft = Color(0xFFF7F7F5)
private val V8Success = Color(0xFF2B713B)

@Composable
fun LaTeXViewerApp(viewModel: ViewerViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val snackbarHost = remember { SnackbarHostState() }
    val projectListState = remember { LazyListState() }
    val downloadListState = remember { LazyListState() }
    val apkInstaller = remember(context) { ApkInstaller(context.applicationContext) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    var askedForNotifications by rememberSaveable { mutableStateOf(false) }
    var selectedProjectName by rememberSaveable { mutableStateOf<String?>(null) }
    var lastProjectName by rememberSaveable { mutableStateOf<String?>(null) }
    val selectedProject = state.repositories.firstOrNull {
        it.fullName.equals(selectedProjectName, ignoreCase = true)
    }

    LaunchedEffect(state.transfer?.workId, state.downloadTasks) {
        val active = state.transfer != null || state.downloadTasks.any(::v8TaskActive)
        if (active && !askedForNotifications && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            askedForNotifications = true
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let { snackbarHost.showSnackbar(it); viewModel.clearError() }
    }
    LaunchedEffect(state.notice) {
        state.notice?.let { snackbarHost.showSnackbar(it); viewModel.clearNotice() }
    }
    LaunchedEffect(state.externalUrl) {
        state.externalUrl?.let { runCatching { uriHandler.openUri(it) }; viewModel.consumeExternalUrl() }
    }
    LaunchedEffect(state.externalFile) {
        state.externalFile?.let { file ->
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(file.contentUri), file.mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runCatching { context.startActivity(Intent.createChooser(intent, "Open ${file.name}")) }
                .onFailure { failure ->
                    viewModel.showError(
                        if (failure is ActivityNotFoundException) "No app can open ${file.name}"
                        else failure.message ?: "Unable to open the downloaded file"
                    )
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
            runCatching { context.startActivity(Intent.createChooser(intent, "Share ${file.name}")) }
                .onFailure { viewModel.showError(it.message ?: "Unable to share this file") }
            viewModel.consumeShareFile()
        }
    }

    fun installUpdate() {
        val path = state.downloadedApkPath ?: return
        if (!apkInstaller.canRequestInstall()) {
            apkInstaller.openInstallPermission()
            viewModel.showNotice("Allow this app to install updates, then tap Install again")
            return
        }
        runCatching { apkInstaller.install(path) }
            .onFailure { viewModel.showError(it.message ?: "Unable to open the Android installer") }
    }

    BackHandler(
        enabled = selectedProject != null || state.screen !in setOf(
            ViewerScreen.REPOSITORIES,
            ViewerScreen.HOME,
            ViewerScreen.DOWNLOADS,
            ViewerScreen.SETTINGS
        )
    ) {
        if (selectedProject != null && state.screen == ViewerScreen.REPOSITORIES) selectedProjectName = null
        else viewModel.goBack()
    }

    LaTeXViewerTheme {
        CompositionLocalProvider(LocalLiquidGlassMode provides state.glassMode) {
            val hazeState = rememberHazeState()
            Scaffold(
                containerColor = MaterialTheme.colorScheme.background,
                snackbarHost = { SnackbarHost(snackbarHost) },
                bottomBar = {
                    if (state.screen != ViewerScreen.PDF && state.screen != ViewerScreen.TEXT) {
                        LiquidGlassBottomBar(
                            selected = when {
                                selectedProject != null -> "projects"
                                state.screen == ViewerScreen.CONNECT -> "projects"
                                else -> state.screen.name
                            },
                            downloadActive = state.transfer != null || state.downloadTasks.any(::v8TaskActive),
                            onProjects = { selectedProjectName = null; viewModel.openProjects() },
                            onFiles = {
                                val project = state.currentRepository
                                    ?: state.repositories.firstOrNull { it.fullName.equals(lastProjectName, true) }
                                    ?: selectedProject
                                if (project == null) {
                                    selectedProjectName = null
                                    viewModel.openProjects()
                                    viewModel.showNotice("Select a project first")
                                } else {
                                    selectedProjectName = null
                                    lastProjectName = project.fullName
                                    viewModel.openRepository(project)
                                }
                            },
                            onReader = {
                                selectedProjectName = null
                                val reading = state.recentReadings.firstOrNull() ?: state.recentReading
                                if (reading == null) viewModel.openHome() else viewModel.openRecentReading(reading)
                            },
                            onDownloads = { selectedProjectName = null; viewModel.openDownloads() },
                            onSettings = { selectedProjectName = null; viewModel.openSettings() },
                            hazeState = hazeState
                        )
                    }
                }
            ) { padding ->
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .liquidGlassSource(hazeState)
                ) {
                    when (state.screen) {
                        ViewerScreen.REPOSITORIES -> if (selectedProject == null) {
                            V8ProjectsScreen(
                                state = state,
                                listState = projectListState,
                                onOpen = { lastProjectName = it.fullName; selectedProjectName = it.fullName },
                                onAdd = viewModel::openAddProject,
                                onRefresh = viewModel::refresh,
                                onDownload = viewModel::downloadRepository,
                                onRemove = viewModel::removeRepository,
                                onNotice = viewModel::showNotice
                            )
                        } else {
                            V8ProjectHomeScreen(
                                repository = selectedProject,
                                index = state.mobileIndexes[selectedProject.fullName.lowercase()],
                                readings = state.recentReadings.filter { it.repositoryFullName.equals(selectedProject.fullName, true) },
                                offline = state.offlineDocuments.filter { it.repositoryFullName.equals(selectedProject.fullName, true) },
                                onBack = { selectedProjectName = null },
                                onOpenPdf = { viewModel.openMobilePdf(selectedProject, it) },
                                onOpenReading = viewModel::openRecentReading,
                                onBrowseFiles = {
                                    lastProjectName = selectedProject.fullName
                                    viewModel.openRepository(selectedProject)
                                },
                                onDownloadProject = { viewModel.downloadRepository(selectedProject) },
                                onOpenResearch = { viewModel.openResearchAttachment(selectedProject, it) },
                                onNotice = viewModel::showNotice
                            )
                        }
                        ViewerScreen.CONNECT -> V8ProjectsScreen(
                            state = state,
                            listState = projectListState,
                            onOpen = { lastProjectName = it.fullName; selectedProjectName = it.fullName },
                            onAdd = {},
                            onRefresh = viewModel::refresh,
                            onDownload = viewModel::downloadRepository,
                            onRemove = viewModel::removeRepository,
                            onNotice = viewModel::showNotice,
                            addDialogVisible = true,
                            addLoading = state.loading,
                            onDismissAdd = viewModel::goBack,
                            onConfirmAdd = { viewModel.connect("", it) }
                        )
                        ViewerScreen.FILES -> V8FilesScreen(
                            state = state,
                            onBack = viewModel::goBack,
                            onOpen = viewModel::openContent,
                            onDownload = viewModel::downloadFile,
                            onDownloadProject = { state.currentRepository?.let(viewModel::downloadRepository) },
                            onRefresh = viewModel::refresh,
                            onOpenGitHub = viewModel::openCurrentOnGitHub,
                            onNotice = viewModel::showNotice
                        )
                        ViewerScreen.HOME -> V8ReaderHomeScreen(
                            state = state,
                            onOpenReading = viewModel::openRecentReading,
                            onOpenOffline = viewModel::openOfflineDocument,
                            onOpenProjects = viewModel::openProjects
                        )
                        ViewerScreen.DOWNLOADS -> V8DownloadsScreen(
                            state = state,
                            listState = downloadListState,
                            onOpen = viewModel::openDownloaded,
                            onShare = viewModel::shareDownloaded,
                            onRemove = viewModel::removeDownloadRecord,
                            onClear = viewModel::clearDownloadHistory,
                            onRetry = viewModel::retryDownloadTask,
                            onCancel = viewModel::cancelDownloadTask,
                            onOpenOffline = viewModel::openOfflineDocument,
                            onNotice = viewModel::showNotice
                        )
                        ViewerScreen.SETTINGS -> V8SettingsScreen(
                            state = state,
                            onCheckUpdate = { viewModel.checkForUpdates() },
                            onDownloadUpdate = viewModel::downloadUpdate,
                            onCancelUpdate = viewModel::cancelUpdateDownload,
                            onInstallUpdate = ::installUpdate,
                            onClearCache = viewModel::clearPdfCache,
                            onManageOffline = viewModel::openDownloads,
                            onNotice = viewModel::showNotice
                        )
                        ViewerScreen.TEXT -> V8TextScreen(
                            state = state,
                            onBack = viewModel::goBack,
                            onOpenGitHub = viewModel::openCurrentOnGitHub
                        )
                        ViewerScreen.PDF -> PdfPreviewScreen(
                            state = state,
                            onBack = viewModel::goBack,
                            onOpenGitHub = viewModel::openCurrentOnGitHub,
                            onDownload = viewModel::downloadCurrentPdf,
                            onRetry = viewModel::retryCurrentPdf,
                            onOpenExternal = viewModel::openCurrentPdfExternally,
                            onKeepOffline = viewModel::keepCurrentPdfOffline,
                            onRemoveOffline = viewModel::removeCurrentPdfOffline,
                            onPageChanged = viewModel::recordPdfPage,
                            bookmarks = state.pdfBookmarks,
                            onToggleBookmark = viewModel::togglePdfBookmark
                        )
                    }

                    if (state.loading && state.screen != ViewerScreen.CONNECT) {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter),
                            color = V8Ink,
                            trackColor = V8LineSoft
                        )
                    }
                    state.transfer?.takeIf { state.transferPanelVisible && state.screen != ViewerScreen.DOWNLOADS }?.let { transfer ->
                        V8TransferToast(
                            transfer = transfer,
                            onOpen = viewModel::openDownloads,
                            onHide = viewModel::hideTransferPanel,
                            onCancel = viewModel::cancelTransfer,
                            hazeState = hazeState,
                            modifier = Modifier.align(Alignment.BottomCenter).padding(horizontal = 18.dp, vertical = 8.dp)
                        )
                    }
                }
            }
        }
    }
}

private fun v8TaskActive(task: PersistentDownloadTask): Boolean = task.state in setOf(
    PersistentDownloadState.QUEUED,
    PersistentDownloadState.RUNNING,
    PersistentDownloadState.WAITING_FOR_NETWORK
)

@Composable
private fun V8TopBar(
    title: String,
    modifier: Modifier = Modifier,
    back: (() -> Unit)? = null,
    projectTitle: Boolean = false,
    readerTitle: Boolean = false,
    actions: @Composable RowScope.() -> Unit = {}
) {
    Row(
        modifier = modifier.fillMaxWidth().height(50.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (back != null) V8IconButton(Icons.AutoMirrored.Outlined.ArrowBack, "Back", back)
        Text(
            text = title,
            modifier = Modifier.weight(1f).semantics { heading() },
            style = when {
                readerTitle -> MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp, lineHeight = 20.sp)
                projectTitle -> MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Serif, fontSize = 20.sp, lineHeight = 25.sp)
                else -> TextStyle(fontFamily = FontFamily.Serif, fontSize = 32.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.6).sp)
            },
            fontWeight = if (readerTitle) FontWeight.Medium else FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

@Composable
private fun V8IconButton(icon: ImageVector, label: String, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(42.dp)
    ) {
        Icon(
            icon,
            contentDescription = label,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onSurface
        )
    }
}

@Composable
private fun V8PlusButton(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.size(36.dp),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 2.dp
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Add, contentDescription = "Add project", modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun V8SearchField(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    Surface(
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 13.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Outlined.Search, contentDescription = null, modifier = Modifier.size(18.dp), tint = V8Muted)
            Spacer(Modifier.width(9.dp))
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                decorationBox = { inner ->
                    if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = V8Muted)
                    inner()
                }
            )
        }
    }
}

@Composable
private fun V8SectionTitle(title: String, modifier: Modifier = Modifier) {
    Text(
        title,
        modifier = modifier.fillMaxWidth().padding(start = 4.dp, top = 26.dp, bottom = 12.dp).semantics { heading() },
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = 19.sp,
        lineHeight = 24.sp
    )
}

private enum class V8ProjectSort { DEFAULT, NAME, FAVORITES }

@Composable
private fun V8ProjectsScreen(
    state: ViewerUiState,
    listState: LazyListState,
    onOpen: (GitHubRepository) -> Unit,
    onAdd: () -> Unit,
    onRefresh: () -> Unit,
    onDownload: (GitHubRepository) -> Unit,
    onRemove: (GitHubRepository) -> Unit,
    onNotice: (String) -> Unit,
    addDialogVisible: Boolean = false,
    addLoading: Boolean = false,
    onDismissAdd: () -> Unit = {},
    onConfirmAdd: (String) -> Unit = {}
) {
    var searchVisible by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var sortName by rememberSaveable { mutableStateOf(V8ProjectSort.DEFAULT.name) }
    var pinnedNames by rememberSaveable { mutableStateOf(listOf<String>()) }
    var favoriteNames by rememberSaveable { mutableStateOf(listOf<String>()) }
    var actionProject by remember { mutableStateOf<GitHubRepository?>(null) }
    var libraryMenu by remember { mutableStateOf(false) }
    val sort = runCatching { V8ProjectSort.valueOf(sortName) }.getOrDefault(V8ProjectSort.DEFAULT)

    LaunchedEffect(state.repositories.map { it.fullName }) {
        if (pinnedNames.isEmpty() && state.repositories.isNotEmpty()) {
            pinnedNames = state.repositories.take(2).map { it.fullName }
            favoriteNames = state.repositories.take(1).map { it.fullName }
        }
    }

    fun toggleFavorite(repository: GitHubRepository) {
        favoriteNames = if (repository.fullName in favoriteNames) favoriteNames - repository.fullName else favoriteNames + repository.fullName
        onNotice(if (repository.fullName in favoriteNames) "Added to Favorites" else "Removed from Favorites")
    }
    fun togglePinned(repository: GitHubRepository) {
        pinnedNames = if (repository.fullName in pinnedNames) pinnedNames - repository.fullName else pinnedNames + repository.fullName
        onNotice(if (repository.fullName in pinnedNames) "Pinned to Top" else "Unpinned")
    }

    actionProject?.let { repository ->
        V8ProjectActionSheet(
            repository = repository,
            pinned = repository.fullName in pinnedNames,
            favorite = repository.fullName in favoriteNames,
            onDismiss = { actionProject = null },
            onPin = { togglePinned(repository); actionProject = null },
            onFavorite = { toggleFavorite(repository); actionProject = null },
            onOffline = { actionProject = null; onOpen(repository); onNotice("Open the project to save its main PDF offline") },
            onDownload = { actionProject = null; onDownload(repository) },
            onRemove = { actionProject = null; onRemove(repository) }
        )
    }
    if (libraryMenu) {
        V8GenericDialog(
            title = "Project Library",
            subtitle = "Library-wide actions",
            onDismiss = { libraryMenu = false }
        ) {
            V8DialogAction(Icons.Outlined.Add, "Import Project") { libraryMenu = false; onAdd() }
            V8DialogAction(Icons.Outlined.Star, "Favorites first") {
                libraryMenu = false
                sortName = V8ProjectSort.FAVORITES.name
            }
            V8DialogAction(Icons.Outlined.Refresh, "Refresh projects") { libraryMenu = false; onRefresh() }
        }
    }

    val visible = state.repositories
        .filter { it.name.contains(query.trim(), true) || it.fullName.contains(query.trim(), true) }
        .let { repositories ->
            when (sort) {
                V8ProjectSort.DEFAULT -> repositories
                V8ProjectSort.NAME -> repositories.sortedBy { it.name.lowercase() }
                V8ProjectSort.FAVORITES -> repositories.sortedWith(
                    compareByDescending<GitHubRepository> { it.fullName in favoriteNames }.thenBy { it.name.lowercase() }
                )
            }
        }
    val pinned = visible.filter { it.fullName in pinnedNames }
    val all = visible.filterNot { it.fullName in pinnedNames }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 26.dp, end = 26.dp, top = 0.dp, bottom = 28.dp)
    ) {
        item {
            V8TopBar(title = "Projects") {
                V8PlusButton(onAdd)
                V8IconButton(Icons.Outlined.Search, "Search projects") { searchVisible = !searchVisible }
                V8IconButton(Icons.Outlined.Sort, "Sort projects") {
                    sortName = when (sort) {
                        V8ProjectSort.DEFAULT -> V8ProjectSort.NAME.name
                        V8ProjectSort.NAME -> V8ProjectSort.FAVORITES.name
                        V8ProjectSort.FAVORITES -> V8ProjectSort.DEFAULT.name
                    }
                    onNotice(
                        when (V8ProjectSort.valueOf(sortName)) {
                            V8ProjectSort.DEFAULT -> "Default order"
                            V8ProjectSort.NAME -> "Sorted by name"
                            V8ProjectSort.FAVORITES -> "Favorites first"
                        }
                    )
                }
                V8IconButton(Icons.Outlined.MoreVert, "Projects menu") { libraryMenu = true }
            }
            if (searchVisible) {
                Spacer(Modifier.height(10.dp))
                V8SearchField(query, { query = it }, "Search projects")
            }
        }

        if (state.repositoriesStale) {
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    shape = RoundedCornerShape(12.dp),
                    color = V8Soft,
                    border = BorderStroke(1.dp, V8Line)
                ) {
                    Text("Offline snapshot · showing the last saved project list", modifier = Modifier.padding(11.dp), fontSize = 11.sp, color = V8Muted)
                }
            }
        }

        if (state.repositories.isEmpty() && !state.loading) {
            item {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = 90.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(Icons.Outlined.Folder, contentDescription = null, modifier = Modifier.size(42.dp))
                    Spacer(Modifier.height(14.dp))
                    Text("No projects yet", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    Text("Add a public or private GitHub LaTeX project.", modifier = Modifier.padding(top = 6.dp), color = V8Muted, fontSize = 12.sp)
                    Button(onClick = onAdd, modifier = Modifier.padding(top = 18.dp), colors = ButtonDefaults.buttonColors(containerColor = V8Ink)) {
                        Text("Add Project")
                    }
                }
            }
        }

        if (pinned.isNotEmpty()) {
            item { V8SectionTitle("Pinned") }
            items(pinned, key = { "pinned:${it.fullName}" }) { repository ->
                V8ProjectRow(
                    repository = repository,
                    metadata = v8ProjectMetadata(repository, state.recentReadings, state.repositoryRefreshFailures.containsKey(repository.fullName.lowercase())),
                    favorite = repository.fullName in favoriteNames,
                    onOpen = { onOpen(repository) },
                    onFavorite = { toggleFavorite(repository) },
                    onMore = { actionProject = repository },
                    modifier = Modifier.padding(bottom = 9.dp)
                )
            }
        }
        if (all.isNotEmpty()) {
            item { V8SectionTitle("All Projects") }
            items(all, key = { "all:${it.fullName}" }) { repository ->
                V8ProjectRow(
                    repository = repository,
                    metadata = v8ProjectMetadata(repository, state.recentReadings, state.repositoryRefreshFailures.containsKey(repository.fullName.lowercase())),
                    favorite = repository.fullName in favoriteNames,
                    onOpen = { onOpen(repository) },
                    onFavorite = { toggleFavorite(repository) },
                    onMore = { actionProject = repository },
                    modifier = Modifier.padding(bottom = 9.dp)
                )
            }
        }
        if (visible.isEmpty() && state.repositories.isNotEmpty()) {
            item {
                Text("No projects match “$query”", modifier = Modifier.fillMaxWidth().padding(top = 60.dp), textAlign = TextAlign.Center, color = V8Muted)
            }
        }
    }

    if (addDialogVisible) {
        V8AddProjectDialog(
            loading = addLoading,
            onDismiss = onDismissAdd,
            onConfirm = onConfirmAdd
        )
    }
}

@Composable
private fun V8ProjectRow(
    repository: GitHubRepository,
    metadata: String,
    favorite: Boolean,
    onOpen: () -> Unit,
    onFavorite: () -> Unit,
    onMore: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth().heightIn(min = 61.dp),
        shape = RoundedCornerShape(15.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 2.dp
    ) {
        Row(
            modifier = Modifier.padding(start = 11.dp, end = 3.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                onClick = onOpen,
                modifier = Modifier.size(39.dp),
                shape = RoundedCornerShape(11.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, V8LineSoft)
            ) { Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Folder, null, Modifier.size(23.dp)) } }
            Spacer(Modifier.width(13.dp))
            Surface(onClick = onOpen, color = Color.Transparent, modifier = Modifier.weight(1f)) {
                Column(modifier = Modifier.padding(vertical = 3.dp)) {
                    Text(repository.name, fontFamily = FontFamily.Serif, fontSize = 15.sp, lineHeight = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(metadata, modifier = Modifier.padding(top = 3.dp), fontSize = 10.7.sp, lineHeight = 14.sp, color = V8Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            IconButton(onClick = onFavorite, modifier = Modifier.size(36.dp)) {
                Icon(if (favorite) Icons.Outlined.Star else Icons.Outlined.StarBorder, if (favorite) "Remove from Favorites" else "Add to Favorites", Modifier.size(22.dp))
            }
            V8IconButton(Icons.Outlined.MoreVert, "Project actions", onMore)
        }
    }
}

private fun v8ProjectMetadata(repository: GitHubRepository, readings: List<ReadingProgress>, stale: Boolean): String {
    val reading = readings.firstOrNull { it.repositoryFullName.equals(repository.fullName, true) }
    return when {
        reading != null -> "Continue · Page ${reading.pageIndex + 1}"
        stale -> "Offline snapshot"
        repository.updatedAt.isNotBlank() -> "Updated ${repository.updatedAt.take(10)}"
        else -> repository.owner
    }
}

@Composable
private fun V8AddProjectDialog(
    loading: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var url by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!loading) onDismiss() },
        shape = RoundedCornerShape(24.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        title = {
            Text("Add GitHub Project", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 25.sp)
        },
        text = {
            Column {
                Text("移动端只读取仓库内容，不会修改、提交或覆盖 GitHub 仓库。", color = V8Muted, fontSize = 12.sp, lineHeight = 18.sp)
                Text("GitHub Repository URL", modifier = Modifier.padding(top = 18.dp, bottom = 8.dp), fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    border = BorderStroke(1.dp, Color(0xFFD9D9D5)),
                    color = MaterialTheme.colorScheme.surface
                ) {
                    BasicTextField(
                        value = url,
                        onValueChange = { url = it },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 13.dp, vertical = 15.dp),
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                        decorationBox = { inner ->
                            if (url.isBlank()) Text("https://github.com/user/project", color = V8Muted, fontSize = 13.sp)
                            inner()
                        }
                    )
                }
                if (loading) {
                    Row(modifier = Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = V8Ink)
                        Text("Reading repository metadata…", modifier = Modifier.padding(start = 9.dp), color = V8Muted, fontSize = 12.sp)
                    }
                }
            }
        },
        dismissButton = {
            OutlinedButton(onClick = onDismiss, enabled = !loading, shape = RoundedCornerShape(21.dp), modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancel") }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(url.trim()) },
                enabled = !loading && url.isNotBlank(),
                shape = RoundedCornerShape(21.dp),
                colors = ButtonDefaults.buttonColors(containerColor = V8Ink),
                modifier = Modifier.heightIn(min = 48.dp)
            ) { Text("Add Project") }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun V8ProjectActionSheet(
    repository: GitHubRepository,
    pinned: Boolean,
    favorite: Boolean,
    onDismiss: () -> Unit,
    onPin: () -> Unit,
    onFavorite: () -> Unit,
    onOffline: () -> Unit,
    onDownload: () -> Unit,
    onRemove: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.98f),
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    ) {
        Column(modifier = Modifier.padding(start = 19.dp, end = 19.dp, bottom = 24.dp)) {
            Text(repository.name, modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp), fontFamily = FontFamily.Serif, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            V8SheetAction(Icons.Outlined.Sort, if (pinned) "Unpin" else "Pin to Top", onPin)
            V8SheetAction(if (favorite) Icons.Outlined.Star else Icons.Outlined.StarBorder, if (favorite) "Remove from Favorites" else "Add to Favorites", onFavorite)
            V8SheetAction(Icons.Outlined.Download, "Save Main PDF Offline", onOffline)
            V8SheetAction(Icons.Outlined.Download, "Download Project ZIP", onDownload)
            V8SheetAction(Icons.Outlined.DeleteOutline, "Remove from this phone", onRemove, destructive = true)
            OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 12.dp), shape = RoundedCornerShape(13.dp)) { Text("Cancel") }
        }
    }
}

@Composable
private fun V8SheetAction(icon: ImageVector, text: String, onClick: () -> Unit, destructive: Boolean = false) {
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
        Row(modifier = Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(22.dp), tint = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
            Text(text, modifier = Modifier.padding(start = 12.dp), color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        }
    }
    HorizontalDivider(color = V8LineSoft)
}

@Composable
private fun V8GenericDialog(
    title: String,
    subtitle: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(22.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        title = { Text(title, fontFamily = FontFamily.Serif, fontSize = 20.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                if (subtitle.isNotBlank()) Text(subtitle, modifier = Modifier.padding(bottom = 8.dp), color = V8Muted, fontSize = 12.sp)
                content()
            }
        },
        confirmButton = {
            Button(onClick = onDismiss, colors = ButtonDefaults.buttonColors(containerColor = V8Ink), shape = RoundedCornerShape(12.dp)) { Text("Close") }
        }
    )
}

@Composable
private fun V8DialogAction(icon: ImageVector, text: String, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(21.dp))
            Text(text, modifier = Modifier.padding(start = 12.dp), fontSize = 14.sp)
        }
    }
    HorizontalDivider(color = V8LineSoft)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun V8ProjectHomeScreen(
    repository: GitHubRepository,
    index: MobileProjectIndex?,
    readings: List<ReadingProgress>,
    offline: List<OfflinePdfDocument>,
    onBack: () -> Unit,
    onOpenPdf: (MobilePdfOutput) -> Unit,
    onOpenReading: (ReadingProgress) -> Unit,
    onBrowseFiles: () -> Unit,
    onDownloadProject: () -> Unit,
    onOpenResearch: (ResearchAttachment) -> Unit,
    onNotice: (String) -> Unit
) {
    val mainOutput = index?.defaultOutput ?: index?.outputs?.firstOrNull()
    val reading = readings.firstOrNull { progress ->
        mainOutput?.pdfPath?.let { it.equals(progress.pdfPath, true) } == true
    } ?: readings.firstOrNull()
    val offlineMain = mainOutput?.let { output -> offline.any { it.pdfPath.equals(output.pdfPath, true) } } == true
    var favorite by rememberSaveable(repository.fullName) { mutableStateOf(true) }
    var actionsVisible by remember { mutableStateOf(false) }
    val page = (reading?.pageIndex ?: 0) + 1
    val pageCount = reading?.pageCount?.coerceAtLeast(0) ?: 0
    val progress = if (pageCount > 0) (page.toFloat() / pageCount.toFloat()).coerceIn(0f, 1f) else 0f

    if (actionsVisible) {
        ModalBottomSheet(
            onDismissRequest = { actionsVisible = false },
            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.98f),
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
        ) {
            Column(modifier = Modifier.padding(start = 19.dp, end = 19.dp, bottom = 24.dp)) {
                Text(repository.name, modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp), fontFamily = FontFamily.Serif, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                V8SheetAction(Icons.Outlined.Sort, "Pin to Top", { actionsVisible = false; onNotice("Pinned to Top") })
                V8SheetAction(if (favorite) Icons.Outlined.Star else Icons.Outlined.StarBorder, if (favorite) "Remove from Favorites" else "Add to Favorites", {
                    favorite = !favorite; actionsVisible = false
                    onNotice(if (favorite) "Added to Favorites" else "Removed from Favorites")
                })
                V8SheetAction(Icons.Outlined.Download, "Save Main PDF Offline", {
                    actionsVisible = false
                    if (mainOutput != null) onOpenPdf(mainOutput) else onNotice("This project has no main PDF")
                })
                V8SheetAction(Icons.Outlined.Info, "Project Info", { actionsVisible = false; onNotice("GitHub read-only repository") })
                V8SheetAction(Icons.Outlined.Download, "Download Project ZIP", { actionsVisible = false; onDownloadProject() })
                OutlinedButton(onClick = { actionsVisible = false }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 12.dp), shape = RoundedCornerShape(13.dp)) { Text("Cancel") }
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 26.dp, end = 26.dp, top = 0.dp, bottom = 28.dp)
    ) {
        item {
            V8TopBar(title = repository.name, back = onBack, projectTitle = true) {
                V8IconButton(if (favorite) Icons.Outlined.Star else Icons.Outlined.StarBorder, if (favorite) "Remove from Favorites" else "Add to Favorites", {
                    favorite = !favorite
                    onNotice(if (favorite) "Added to Favorites" else "Removed from Favorites")
                })
                V8IconButton(Icons.Outlined.MoreVert, "Project actions") { actionsVisible = true }
            }
        }
        item {
            V8MainPdfCard(
                repository = repository,
                output = mainOutput,
                reading = reading,
                offline = offlineMain,
                progress = progress,
                onOpen = {
                    when {
                        mainOutput != null -> onOpenPdf(mainOutput)
                        reading != null -> onOpenReading(reading)
                        else -> onNotice("This project has no main PDF")
                    }
                }
            )
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                V8QuickCard(Icons.Outlined.Folder, "Files", "Browse repository", onBrowseFiles, Modifier.weight(1f))
                V8QuickCard(Icons.Outlined.BookmarkBorder, "Bookmarks", "${readings.count { it.pageIndex > 0 }} bookmarks", {
                    reading?.let(onOpenReading) ?: onNotice("No bookmarks yet")
                }, Modifier.weight(1f))
            }
        }

        item { V8SectionTitle("Recently Viewed", Modifier.padding(top = 0.dp)) }
        item {
            V8Group {
                val recent = readings.take(4)
                if (recent.isEmpty()) {
                    V8RecentRow(
                        icon = Icons.Outlined.Description,
                        name = mainOutput?.entry ?: "main.tex",
                        trailing = "Read-only",
                        onClick = onBrowseFiles
                    )
                } else {
                    recent.forEachIndexed { index, item ->
                        V8RecentRow(
                            icon = Icons.Outlined.Description,
                            name = item.pdfName,
                            trailing = "Page ${item.pageIndex + 1}",
                            onClick = { onOpenReading(item) }
                        )
                        if (index < recent.lastIndex) HorizontalDivider(color = V8LineSoft)
                    }
                }
            }
        }

        if (!index?.researchItems.isNullOrEmpty()) {
            item { V8SectionTitle("Research Materials", Modifier.padding(top = 0.dp)) }
            item {
                V8Group {
                    index?.researchItems.orEmpty().take(4).forEachIndexed { itemIndex, research ->
                        val attachment = v8ResearchAttachment(research)
                        V8RecentRow(
                            icon = if (attachment?.mediaType?.contains("pdf", true) == true) Icons.Outlined.PictureAsPdf else Icons.Outlined.Description,
                            name = research.displayTitle,
                            trailing = if (attachment?.canDownload == true) "Open" else "Computer only",
                            onClick = { attachment?.let(onOpenResearch) ?: onNotice("This material is only available on the computer") }
                        )
                        if (itemIndex < index.researchItems.take(4).lastIndex) HorizontalDivider(color = V8LineSoft)
                    }
                }
            }
        }

        item { V8SectionTitle("Project Info", Modifier.padding(top = 0.dp)) }
        item {
            Surface(
                onClick = { onNotice("GitHub read-only repository") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, V8Line),
                shadowElevation = 2.dp
            ) {
                Row(modifier = Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Info, null, Modifier.size(22.dp))
                    Column(modifier = Modifier.weight(1f).padding(horizontal = 10.dp)) {
                        Text(
                            "${repository.defaultBranch} · Updated ${repository.updatedAt.take(10)} · ${v8FormatBytes(repository.sizeKb * 1024)}",
                            fontFamily = FontFamily.Serif,
                            fontSize = 13.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text("GitHub read-only repository", modifier = Modifier.padding(top = 2.dp), color = V8Muted, fontSize = 12.sp)
                    }
                    Text("›", fontSize = 20.sp)
                }
            }
        }
    }
}

private fun v8ResearchAttachment(item: ProjectResearchItem): ResearchAttachment? {
    val preferredIds = item.links.mapNotNull { it.preferredAttachmentId }
    return item.attachments.firstOrNull { it.id in preferredIds && it.canDownload }
        ?: item.attachments.firstOrNull { it.canDownload }
        ?: item.attachments.firstOrNull()
}

@Composable
private fun V8MainPdfCard(
    repository: GitHubRepository,
    output: MobilePdfOutput?,
    reading: ReadingProgress?,
    offline: Boolean,
    progress: Float,
    onOpen: () -> Unit
) {
    Surface(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth().padding(top = 19.dp),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, V8Line),
        shadowElevation = 3.dp
    ) {
        BoxWithConstraints(modifier = Modifier.padding(14.dp)) {
            val coverWidth = if (maxWidth >= 350.dp) 124.dp else (maxWidth * 0.35f).coerceAtLeast(102.dp)
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                V8BookCover(repository.name, Modifier.width(coverWidth).height(186.dp))
                Column(modifier = Modifier.weight(1f).heightIn(min = 186.dp)) {
                    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, Color(0xFFE3E3DF))) {
                        Text("Main PDF", modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), fontSize = 11.sp)
                    }
                    Text(
                        output?.name ?: output?.pdfPath?.substringAfterLast('/') ?: "No main PDF",
                        modifier = Modifier.padding(top = 7.dp),
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        fontSize = 21.sp,
                        lineHeight = 23.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        if ((reading?.pageCount ?: 0) > 0) "${reading?.pageCount} pages" else output?.size?.let(::v8FormatBytes) ?: "PDF output",
                        modifier = Modifier.padding(top = 5.dp),
                        color = V8Muted,
                        fontSize = 12.sp
                    )
                    Text(
                        if (reading != null) "Last read: Page ${reading.pageIndex + 1}" else "Not read yet",
                        modifier = Modifier.padding(top = 8.dp),
                        fontSize = 12.sp
                    )
                    Row(modifier = Modifier.fillMaxWidth().padding(top = 7.dp)) {
                        Text("Reading progress", modifier = Modifier.weight(1f), fontSize = 11.sp)
                        Text("${(progress * 100).roundToInt()}%", fontSize = 11.sp)
                    }
                    V8Progress(progress, Modifier.padding(top = 5.dp))
                    Surface(
                        modifier = Modifier.padding(top = 7.dp),
                        shape = RoundedCornerShape(9.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, Color(0xFFE4E4E1))
                    ) {
                        Row(modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.CloudQueue, null, Modifier.size(14.dp))
                            Text(if (offline) "Offline" else "Online", modifier = Modifier.padding(start = 5.dp), fontSize = 10.5.sp)
                        }
                    }
                }
            }
            Button(
                onClick = onOpen,
                modifier = Modifier.fillMaxWidth().align(Alignment.BottomCenter).padding(start = coverWidth + 16.dp).height(42.dp),
                shape = RoundedCornerShape(11.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF050505))
            ) {
                Icon(Icons.Outlined.MenuBook, null, Modifier.size(18.dp))
                Text("Continue Reading", modifier = Modifier.padding(start = 7.dp), maxLines = 1, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun V8BookCover(projectName: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = Color(0xFFFBFAF7),
        border = BorderStroke(1.dp, Color(0xFFD8D8D4)),
        shadowElevation = 3.dp
    ) {
        Column(modifier = Modifier.padding(horizontal = 9.dp, vertical = 13.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(v8HumanTitle(projectName), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 17.sp, lineHeight = 19.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("An Introduction", modifier = Modifier.padding(top = 4.dp), fontFamily = FontFamily.Serif, fontSize = 10.sp)
            Canvas(modifier = Modifier.fillMaxWidth().weight(1f).padding(top = 10.dp)) {
                val nodes = listOf(
                    Offset(size.width * .15f, size.height * .70f), Offset(size.width * .30f, size.height * .28f),
                    Offset(size.width * .55f, size.height * .48f), Offset(size.width * .77f, size.height * .20f),
                    Offset(size.width * .84f, size.height * .75f)
                )
                val edges = listOf(0 to 1, 0 to 2, 0 to 4, 1 to 2, 1 to 3, 2 to 3, 2 to 4, 3 to 4)
                edges.forEach { (a, b) -> drawLine(Color(0xFF6E6E6A), nodes[a], nodes[b], strokeWidth = 1.4f, cap = StrokeCap.Round) }
                nodes.forEach { drawCircle(V8Ink, radius = 3.6f, center = it) }
            }
        }
    }
}

private fun v8HumanTitle(value: String): String = value
    .replace('-', ' ')
    .replace('_', ' ')
    .split(' ')
    .filter(String::isNotBlank)
    .joinToString(" ") { it.replaceFirstChar(Char::uppercase) }
    .ifBlank { "LaTeX Project" }

@Composable
private fun V8QuickCard(icon: ImageVector, title: String, detail: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 72.dp),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, V8Line),
        shadowElevation = 2.dp
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, Modifier.size(22.dp))
                Text(title, modifier = Modifier.padding(start = 9.dp), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
            Text(detail, modifier = Modifier.padding(top = 5.dp), color = V8Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun V8Group(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, V8Line),
        shadowElevation = 2.dp
    ) { Column(content = content) }
}

@Composable
private fun V8RecentRow(icon: ImageVector, name: String, trailing: String, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 45.dp)) {
        Row(modifier = Modifier.padding(horizontal = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(18.dp))
            Text(name, modifier = Modifier.weight(1f).padding(horizontal = 10.dp), fontFamily = FontFamily.Serif, fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(trailing, color = V8Muted, fontSize = 11.sp, maxLines = 1)
            Icon(Icons.Outlined.MoreVert, null, Modifier.padding(start = 7.dp).size(16.dp))
        }
    }
}

@Composable
private fun V8Progress(progress: Float, modifier: Modifier = Modifier, success: Boolean = false) {
    Box(modifier = modifier.fillMaxWidth().height(5.dp).background(Color(0xFFE8E8E6), CircleShape)) {
        Box(
            modifier = Modifier
                .fillMaxWidth(progress.coerceIn(0f, 1f))
                .fillMaxHeight()
                .background(if (success) V8Success else V8Ink, CircleShape)
        )
    }
}

private enum class V8FileFilter(val label: String) {
    ALL("All"), TEX("TeX"), PDF("PDF"), IMAGES("Images"), OTHERS("Others")
}

private enum class V8FileSort { DEFAULT, NAME, TYPE }

@Composable
private fun V8FilesScreen(
    state: ViewerUiState,
    onBack: () -> Unit,
    onOpen: (GitHubContent) -> Unit,
    onDownload: (GitHubContent) -> Unit,
    onDownloadProject: () -> Unit,
    onRefresh: () -> Unit,
    onOpenGitHub: () -> Unit,
    onNotice: (String) -> Unit
) {
    var searchVisible by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var filterName by rememberSaveable { mutableStateOf(V8FileFilter.ALL.name) }
    var sortName by rememberSaveable { mutableStateOf(V8FileSort.DEFAULT.name) }
    var selectMode by rememberSaveable { mutableStateOf(false) }
    var selectedPaths by rememberSaveable { mutableStateOf(listOf<String>()) }
    var menuVisible by remember { mutableStateOf(false) }
    val filter = runCatching { V8FileFilter.valueOf(filterName) }.getOrDefault(V8FileFilter.ALL)
    val sort = runCatching { V8FileSort.valueOf(sortName) }.getOrDefault(V8FileSort.DEFAULT)
    val repository = state.currentRepository
    val visible = state.contents
        .filter { it.name.contains(query.trim(), true) }
        .filter { v8FileMatches(it, filter) }
        .let {
            when (sort) {
                V8FileSort.DEFAULT -> it.sortedWith(compareBy<GitHubContent> { content -> content.kind != GitHubContentKind.DIRECTORY })
                V8FileSort.NAME -> it.sortedBy { content -> content.name.lowercase() }
                V8FileSort.TYPE -> it.sortedWith(compareBy<GitHubContent> { content -> v8FileExtension(content.name) }.thenBy { content -> content.name.lowercase() })
            }
        }

    if (menuVisible) {
        V8GenericDialog(title = "Files", subtitle = "Repository actions", onDismiss = { menuVisible = false }) {
            V8DialogAction(Icons.Outlined.Download, "Download Project ZIP") { menuVisible = false; onDownloadProject() }
            V8DialogAction(Icons.Outlined.OpenInNew, "Open on GitHub") { menuVisible = false; onOpenGitHub() }
            V8DialogAction(Icons.Outlined.Refresh, "Refresh Files") { menuVisible = false; onRefresh() }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 26.dp, end = 26.dp, top = 0.dp, bottom = if (selectMode) 82.dp else 28.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            item {
                V8TopBar(title = "Files") {
                    V8IconButton(Icons.Outlined.Search, "Search files") { searchVisible = !searchVisible }
                    V8IconButton(Icons.Outlined.Sort, "Sort files") {
                        sortName = when (sort) {
                            V8FileSort.DEFAULT -> V8FileSort.NAME.name
                            V8FileSort.NAME -> V8FileSort.TYPE.name
                            V8FileSort.TYPE -> V8FileSort.DEFAULT.name
                        }
                        onNotice(
                            when (V8FileSort.valueOf(sortName)) {
                                V8FileSort.DEFAULT -> "Default file order"
                                V8FileSort.NAME -> "Files sorted by name"
                                V8FileSort.TYPE -> "Files grouped by type"
                            }
                        )
                    }
                    V8IconButton(Icons.Outlined.MoreVert, "Files menu") { menuVisible = true }
                }
                if (searchVisible) {
                    Spacer(Modifier.height(10.dp))
                    V8SearchField(query, { query = it }, "Search files")
                }
                Row(modifier = Modifier.fillMaxWidth().padding(top = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        onClick = { onNotice("Branch: ${repository?.defaultBranch ?: "main"}") },
                        shape = RoundedCornerShape(11.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, V8Line)
                    ) {
                        Text(
                            "⑂  ${repository?.defaultBranch ?: "main"}⌄",
                            modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
                            fontSize = 12.sp
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(
                        onClick = {
                            selectMode = !selectMode
                            if (!selectMode) selectedPaths = emptyList()
                        },
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) { Text(if (selectMode) "Cancel" else "Select", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface) }
                }
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 13.dp, bottom = 9.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    V8FileFilter.entries.forEach { entry ->
                        V8Chip(entry.label, entry == filter) { filterName = entry.name }
                    }
                }
            }

            if (state.currentPath.isNotEmpty()) {
                item {
                    Surface(
                        onClick = onBack,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 43.dp),
                        shape = RoundedCornerShape(11.dp),
                        color = V8Soft,
                        border = BorderStroke(1.dp, V8Line)
                    ) {
                        Row(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, Modifier.size(18.dp))
                            Text(state.currentPath, modifier = Modifier.padding(start = 10.dp), fontFamily = FontFamily.Serif, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            items(visible, key = GitHubContent::path) { item ->
                V8FileRow(
                    item = item,
                    selected = item.path in selectedPaths,
                    selectMode = selectMode,
                    onClick = {
                        if (selectMode) {
                            selectedPaths = if (item.path in selectedPaths) selectedPaths - item.path else selectedPaths + item.path
                        } else onOpen(item)
                    },
                    onDownload = { onDownload(item) },
                    onMore = {
                        if (item.kind == GitHubContentKind.DIRECTORY) onOpen(item)
                        else onNotice("${item.name} · Read-only")
                    }
                )
            }
            if (visible.isEmpty() && !state.loading) {
                item {
                    Text(
                        if (query.isBlank()) "No files in this folder" else "No files match “$query”",
                        modifier = Modifier.fillMaxWidth().padding(top = 60.dp),
                        textAlign = TextAlign.Center,
                        color = V8Muted
                    )
                }
            }
        }

        if (selectMode) {
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).padding(horizontal = 26.dp, vertical = 12.dp).fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = .98f),
                border = BorderStroke(1.dp, V8Line),
                shadowElevation = 4.dp
            ) {
                Row(modifier = Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${selectedPaths.size} selected", modifier = Modifier.weight(1f), color = V8Muted, fontSize = 12.sp)
                    TextButton(onClick = { selectedPaths = emptyList() }) { Text("Clear", color = V8Ink, fontSize = 11.sp) }
                    TextButton(onClick = {
                        if (selectedPaths.isEmpty()) onNotice("Select files first")
                        else {
                            state.contents.filter { it.path in selectedPaths && it.kind == GitHubContentKind.FILE }.forEach(onDownload)
                            onNotice("${selectedPaths.size} files queued")
                        }
                    }) { Text("Download", color = V8Ink, fontSize = 11.sp) }
                }
            }
        }
    }
}

@Composable
private fun V8Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.heightIn(min = 42.dp),
        shape = RoundedCornerShape(13.dp),
        color = if (selected) V8Ink else MaterialTheme.colorScheme.surface,
        contentColor = if (selected) V8Paper else MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, if (selected) V8Ink else Color(0xFFE5E5E2))
    ) {
        Box(modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
            Text(label, fontSize = 12.sp, maxLines = 1)
        }
    }
}

@Composable
private fun V8FileRow(
    item: GitHubContent,
    selected: Boolean,
    selectMode: Boolean,
    onClick: () -> Unit,
    onDownload: () -> Unit,
    onMore: () -> Unit
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        shape = RoundedCornerShape(11.dp),
        color = if (selected) V8Soft else MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, if (selected) V8Ink else V8Line)
    ) {
        Row(modifier = Modifier.padding(start = 9.dp, end = 2.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (selectMode) {
                Surface(
                    modifier = Modifier.size(20.dp),
                    shape = CircleShape,
                    color = if (selected) V8Ink else Color.Transparent,
                    border = BorderStroke(1.5.dp, if (selected) V8Ink else Color(0xFF999999))
                ) { if (selected) Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Check, null, Modifier.size(14.dp), tint = V8Paper) } }
                Spacer(Modifier.width(8.dp))
            }
            Box(modifier = Modifier.size(32.dp), contentAlignment = Alignment.Center) {
                if (item.kind == GitHubContentKind.DIRECTORY) {
                    Icon(Icons.Outlined.Folder, null, Modifier.size(23.dp))
                } else {
                    Surface(shape = RoundedCornerShape(3.dp), color = Color.Transparent, border = BorderStroke(1.dp, V8Ink)) {
                        Text(v8FileLabel(item.name), modifier = Modifier.padding(horizontal = 3.dp, vertical = 5.dp), fontSize = 8.5.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
            Column(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(item.name, fontFamily = FontFamily.Serif, fontSize = 14.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (item.kind == GitHubContentKind.DIRECTORY) "Folder · Read-only" else "${v8FormatBytes(item.size)} · Read-only",
                    modifier = Modifier.padding(top = 1.dp),
                    color = V8Muted,
                    fontSize = 10.8.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (item.kind == GitHubContentKind.FILE && item.name.endsWith(".pdf", true)) {
                IconButton(onClick = onDownload, modifier = Modifier.size(42.dp)) { Icon(Icons.Outlined.Download, "Download ${item.name}", Modifier.size(18.dp)) }
            } else {
                Icon(Icons.Outlined.Check, null, Modifier.size(18.dp), tint = V8Muted)
                Spacer(Modifier.width(5.dp))
            }
            IconButton(onClick = onMore, modifier = Modifier.size(42.dp)) { Icon(Icons.Outlined.MoreVert, "More actions for ${item.name}", Modifier.size(18.dp)) }
        }
    }
}

private fun v8FileMatches(item: GitHubContent, filter: V8FileFilter): Boolean {
    if (filter == V8FileFilter.ALL || item.kind == GitHubContentKind.DIRECTORY) return true
    val ext = v8FileExtension(item.name)
    return when (filter) {
        V8FileFilter.ALL -> true
        V8FileFilter.TEX -> ext in setOf("tex", "bib", "cls", "sty", "bst")
        V8FileFilter.PDF -> ext == "pdf"
        V8FileFilter.IMAGES -> ext in setOf("png", "jpg", "jpeg", "gif", "svg", "webp")
        V8FileFilter.OTHERS -> ext !in setOf("tex", "bib", "cls", "sty", "bst", "pdf", "png", "jpg", "jpeg", "gif", "svg", "webp")
    }
}

private fun v8FileExtension(name: String): String = name.substringAfterLast('.', "").lowercase()

private fun v8FileLabel(name: String): String = when (val ext = v8FileExtension(name)) {
    "pdf" -> "PDF"
    "tex" -> "TEX"
    "bib" -> "BIB"
    "cls" -> "CLS"
    "sty" -> "STY"
    "md" -> "MD"
    else -> ext.take(3).uppercase().ifBlank { "FILE" }
}

@Composable
private fun V8ReaderHomeScreen(
    state: ViewerUiState,
    onOpenReading: (ReadingProgress) -> Unit,
    onOpenOffline: (OfflinePdfDocument) -> Unit,
    onOpenProjects: () -> Unit
) {
    val recent = state.recentReadings.firstOrNull() ?: state.recentReading
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 26.dp, end = 26.dp, bottom = 28.dp)
    ) {
        item { V8TopBar("Reader") }
        if (recent != null) {
            item {
                V8SectionTitle("Continue Reading", Modifier.padding(top = 0.dp))
                Surface(
                    onClick = { onOpenReading(recent) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, V8Line),
                    shadowElevation = 3.dp
                ) {
                    Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        V8MiniCover(recent.projectName, Modifier.width(88.dp).height(124.dp))
                        Column(modifier = Modifier.weight(1f).padding(start = 16.dp)) {
                            Text(recent.pdfName, fontFamily = FontFamily.Serif, fontSize = 20.sp, lineHeight = 23.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(recent.projectName, modifier = Modifier.padding(top = 5.dp), color = V8Muted, fontSize = 12.sp)
                            Text("Last read: Page ${recent.pageIndex + 1}", modifier = Modifier.padding(top = 12.dp), fontSize = 12.sp)
                            val progress = if (recent.pageCount > 0) ((recent.pageIndex + 1).toFloat() / recent.pageCount).coerceIn(0f, 1f) else 0f
                            V8Progress(progress, Modifier.padding(top = 8.dp))
                            Button(
                                onClick = { onOpenReading(recent) },
                                modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(42.dp),
                                shape = RoundedCornerShape(11.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = V8Ink)
                            ) { Text("Continue Reading") }
                        }
                    }
                }
            }
        } else {
            item {
                Column(modifier = Modifier.fillMaxWidth().padding(top = 100.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Outlined.MenuBook, null, Modifier.size(44.dp))
                    Text("Nothing to continue", modifier = Modifier.padding(top = 14.dp), fontFamily = FontFamily.Serif, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text("Open a project's main PDF to begin reading.", modifier = Modifier.padding(top = 6.dp), color = V8Muted, fontSize = 12.sp)
                    Button(onClick = onOpenProjects, modifier = Modifier.padding(top = 18.dp), colors = ButtonDefaults.buttonColors(containerColor = V8Ink)) { Text("Browse Projects") }
                }
            }
        }

        if (state.offlineDocuments.isNotEmpty()) {
            item { V8SectionTitle("Offline PDFs", Modifier.padding(top = 0.dp)) }
            item {
                V8Group {
                    state.offlineDocuments.take(5).forEachIndexed { index, document ->
                        V8RecentRow(Icons.Outlined.PictureAsPdf, document.name, v8FormatBytes(document.size)) { onOpenOffline(document) }
                        if (index < state.offlineDocuments.take(5).lastIndex) HorizontalDivider(color = V8LineSoft)
                    }
                }
            }
        }

        if (state.recentReadings.size > 1) {
            item { V8SectionTitle("Recently Viewed", Modifier.padding(top = 0.dp)) }
            item {
                V8Group {
                    state.recentReadings.drop(1).take(5).forEachIndexed { index, reading ->
                        V8RecentRow(Icons.Outlined.Description, reading.pdfName, "Page ${reading.pageIndex + 1}") { onOpenReading(reading) }
                        if (index < state.recentReadings.drop(1).take(5).lastIndex) HorizontalDivider(color = V8LineSoft)
                    }
                }
            }
        }
    }
}

@Composable
private fun V8MiniCover(title: String, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, shape = RoundedCornerShape(7.dp), color = Color(0xFFFBFAF7), border = BorderStroke(1.dp, Color(0xFFD8D8D4)), shadowElevation = 2.dp) {
        Box(modifier = Modifier.padding(8.dp), contentAlignment = Alignment.Center) {
            Text(v8HumanTitle(title), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 13.sp, lineHeight = 16.sp, textAlign = TextAlign.Center, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun V8DownloadsScreen(
    state: ViewerUiState,
    listState: LazyListState,
    onOpen: (DownloadedFile) -> Unit,
    onShare: (DownloadedFile) -> Unit,
    onRemove: (DownloadedFile) -> Unit,
    onClear: () -> Unit,
    onRetry: (String) -> Unit,
    onCancel: (String) -> Unit,
    onOpenOffline: (OfflinePdfDocument) -> Unit,
    onNotice: (String) -> Unit
) {
    var menuVisible by remember { mutableStateOf(false) }
    var selectedDownload by remember { mutableStateOf<DownloadedFile?>(null) }
    var offlineVisible by remember { mutableStateOf(false) }
    val activeTasks = state.downloadTasks.filter {
        it.kind != PersistentDownloadKind.APP_UPDATE && it.state !in setOf(PersistentDownloadState.SUCCEEDED, PersistentDownloadState.CANCELLED)
    }.sortedByDescending { it.updatedAt }

    if (menuVisible) {
        V8GenericDialog("Download options", "Background download controls", { menuVisible = false }) {
            V8DialogAction(Icons.Outlined.PlayArrow, "Retry failed") {
                menuVisible = false
                state.downloadTasks.filter { it.state == PersistentDownloadState.FAILED }.forEach { onRetry(it.id) }
            }
            V8DialogAction(Icons.Outlined.DeleteOutline, "Clear completed") { menuVisible = false; onClear() }
        }
    }
    if (offlineVisible) {
        V8GenericDialog("Offline PDFs", "${state.offlineDocuments.size} files · ${v8FormatBytes(state.offlinePdfBytes)}", { offlineVisible = false }) {
            state.offlineDocuments.take(8).forEach { document ->
                V8DialogAction(Icons.Outlined.PictureAsPdf, document.name) { offlineVisible = false; onOpenOffline(document) }
            }
        }
    }
    selectedDownload?.let { download ->
        ModalBottomSheet(
            onDismissRequest = { selectedDownload = null },
            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = .98f),
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
        ) {
            Column(modifier = Modifier.padding(start = 19.dp, end = 19.dp, bottom = 24.dp)) {
                Text(download.name, modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp), fontFamily = FontFamily.Serif, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(download.displayPath, modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 8.dp), color = V8Muted, fontSize = 12.sp)
                V8SheetAction(Icons.Outlined.OpenInNew, "Open", { selectedDownload = null; onOpen(download) })
                V8SheetAction(Icons.Outlined.Share, "Share", { selectedDownload = null; onShare(download) })
                V8SheetAction(Icons.Outlined.DeleteOutline, "Remove from history", { selectedDownload = null; onRemove(download) }, destructive = true)
                OutlinedButton(onClick = { selectedDownload = null }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 12.dp), shape = RoundedCornerShape(13.dp)) { Text("Cancel") }
            }
        }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 26.dp, end = 26.dp, bottom = 28.dp)
    ) {
        item {
            V8TopBar("Downloads") {
                V8IconButton(Icons.Outlined.MoreVert, "Downloads menu") { menuVisible = true }
            }
            Surface(
                onClick = { offlineVisible = true },
                modifier = Modifier.fillMaxWidth().padding(top = 19.dp),
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, V8Line),
                shadowElevation = 3.dp
            ) {
                Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudQueue, null, Modifier.size(31.dp))
                    Column(modifier = Modifier.weight(1f).padding(start = 13.dp)) {
                        Text("Offline PDFs", fontFamily = FontFamily.Serif, fontSize = 16.sp)
                        Text("${state.offlineDocuments.size} files · ${v8FormatBytes(state.offlinePdfBytes)}", color = V8Muted, fontSize = 12.sp)
                    }
                    Text("›", fontSize = 20.sp)
                }
            }
        }

        if (activeTasks.isNotEmpty()) {
            item { V8SectionTitle("Active Downloads") }
            item {
                V8Group {
                    activeTasks.forEachIndexed { index, task ->
                        V8DownloadTaskRow(task, onRetry = { onRetry(task.id) }, onCancel = { onCancel(task.id) })
                        if (index < activeTasks.lastIndex) HorizontalDivider(modifier = Modifier.padding(horizontal = 13.dp), color = V8LineSoft)
                    }
                }
            }
        }

        item { V8SectionTitle("Completed") }
        if (state.downloadedFiles.isEmpty()) {
            item {
                Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, V8Line)) {
                    Text("No completed downloads", modifier = Modifier.padding(18.dp), color = V8Muted, textAlign = TextAlign.Center)
                }
            }
        } else {
            item {
                V8Group {
                    state.downloadedFiles.take(12).forEachIndexed { index, download ->
                        V8CompletedDownloadRow(download) { selectedDownload = download }
                        if (index < state.downloadedFiles.take(12).lastIndex) HorizontalDivider(color = V8LineSoft)
                    }
                }
            }
        }

        item {
            Surface(
                onClick = { onNotice("Offline storage: ${v8FormatBytes(state.pdfCacheBytes + state.offlinePdfBytes)}") },
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, V8Line),
                shadowElevation = 2.dp
            ) {
                Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudQueue, null, Modifier.size(28.dp))
                    Column(modifier = Modifier.weight(1f).padding(start = 13.dp)) {
                        Text("${v8FormatBytes(state.pdfCacheBytes + state.offlinePdfBytes)} used", fontFamily = FontFamily.Serif, fontSize = 13.sp)
                        V8Progress(
                            ((state.pdfCacheBytes + state.offlinePdfBytes).toFloat() / state.pdfCacheLimitBytes.coerceAtLeast(1).toFloat()).coerceIn(0f, 1f),
                            Modifier.padding(top = 6.dp)
                        )
                    }
                    Text("›", fontSize = 20.sp)
                }
            }
        }
    }
}

@Composable
private fun V8DownloadTaskRow(task: PersistentDownloadTask, onRetry: () -> Unit, onCancel: () -> Unit) {
    val progress = if (task.total > 0) (task.downloaded.toFloat() / task.total).coerceIn(0f, 1f) else 0f
    Row(modifier = Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Description, null, Modifier.size(22.dp))
        Column(modifier = Modifier.weight(1f).padding(horizontal = 11.dp)) {
            Text(task.name, fontFamily = FontFamily.Serif, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                buildString {
                    append(v8FormatBytes(task.downloaded))
                    if (task.total > 0) append(" / ${v8FormatBytes(task.total)}")
                    if (task.bytesPerSecond > 0) append(" · ${v8FormatBytes(task.bytesPerSecond)}/s")
                },
                color = V8Muted,
                fontSize = 11.sp,
                maxLines = 1
            )
            V8Progress(progress, Modifier.padding(top = 6.dp), success = true)
        }
        Text(if (task.total > 0) "${(progress * 100).roundToInt()}%" else "…", fontSize = 11.sp)
        IconButton(
            onClick = if (task.state == PersistentDownloadState.FAILED) onRetry else onCancel,
            modifier = Modifier.size(38.dp).padding(start = 4.dp)
        ) {
            Icon(if (task.state == PersistentDownloadState.FAILED) Icons.Outlined.PlayArrow else Icons.Outlined.Pause, if (task.state == PersistentDownloadState.FAILED) "Retry" else "Cancel download", Modifier.size(17.dp))
        }
    }
}

@Composable
private fun V8CompletedDownloadRow(download: DownloadedFile, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
        Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (download.kind == DownloadHistoryKind.PDF) Icons.Outlined.Description else Icons.Outlined.Download, null, Modifier.size(21.dp))
            Column(modifier = Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(download.name, fontFamily = FontFamily.Serif, fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(v8FormatDownloadTime(download.downloadedAt), color = V8Muted, fontSize = 10.8.sp)
            }
            Text(v8FormatBytes(download.size), color = V8Muted, fontSize = 11.sp)
            Icon(Icons.Outlined.CheckCircle, null, Modifier.padding(start = 8.dp).size(19.dp), tint = V8Success)
        }
    }
}

@Composable
private fun V8SettingsScreen(
    state: ViewerUiState,
    onCheckUpdate: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onCancelUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onClearCache: () -> Unit,
    onManageOffline: () -> Unit,
    onNotice: (String) -> Unit
) {
    var wifiOnly by rememberSaveable { mutableStateOf(true) }
    var chargingOnly by rememberSaveable { mutableStateOf(false) }
    var restorePosition by rememberSaveable { mutableStateOf(true) }
    var singlePage by rememberSaveable { mutableStateOf(false) }
    var textScale by rememberSaveable { mutableStateOf(100) }
    var moreVisible by rememberSaveable { mutableStateOf(false) }
    var aboutVisible by rememberSaveable { mutableStateOf(false) }
    var clearCacheVisible by rememberSaveable { mutableStateOf(false) }

    val updateTask = state.downloadTasks
        .filter { it.kind == PersistentDownloadKind.APP_UPDATE }
        .maxByOrNull { it.updatedAt }
    val updateActive = updateTask?.state in setOf(
        PersistentDownloadState.QUEUED,
        PersistentDownloadState.RUNNING,
        PersistentDownloadState.WAITING_FOR_NETWORK
    )
    val updateProgress = if ((updateTask?.total ?: -1L) > 0L) {
        (updateTask!!.downloaded.toFloat() / updateTask.total.toFloat()).coerceIn(0f, 1f)
    } else 0f

    if (aboutVisible) {
        V8GenericDialog(
            title = "TeXFlow Mobile",
            subtitle = "Version ${state.currentVersion}",
            onDismiss = { aboutVisible = false }
        ) {
            Text(
                "A read-only companion for your LaTeX projects. Files on GitHub are never edited or deleted by this app.",
                color = V8Muted,
                fontSize = 13.sp,
                lineHeight = 19.sp
            )
        }
    }
    if (moreVisible) {
        V8GenericDialog(
            title = "Settings",
            subtitle = "Application information",
            onDismiss = { moreVisible = false }
        ) {
            V8DialogAction(Icons.Outlined.Info, "About TeXFlow Mobile") {
                moreVisible = false
                aboutVisible = true
            }
            V8DialogAction(Icons.Outlined.Refresh, "Check for updates") {
                moreVisible = false
                onCheckUpdate()
            }
        }
    }
    if (clearCacheVisible) {
        AlertDialog(
            onDismissRequest = { clearCacheVisible = false },
            shape = RoundedCornerShape(24.dp),
            containerColor = MaterialTheme.colorScheme.surface,
            title = { Text("Clear cached thumbnails?", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold) },
            text = { Text("Offline files stay on this device. Temporary PDF pages will be downloaded again when needed.", color = V8Muted) },
            confirmButton = {
                Button(
                    onClick = { clearCacheVisible = false; onClearCache() },
                    colors = ButtonDefaults.buttonColors(containerColor = V8Ink),
                    shape = RoundedCornerShape(12.dp)
                ) { Text("Clear Cache") }
            },
            dismissButton = { TextButton(onClick = { clearCacheVisible = false }) { Text("Cancel") } }
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 26.dp, end = 26.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item {
            V8TopBar("Settings") {
                V8IconButton(Icons.Outlined.MoreVert, "Settings menu") { moreVisible = true }
            }
        }

        item { V8SectionTitle("APP UPDATE") }
        item {
            V8Group {
                V8SettingsBrandRow(state.currentVersion, state.updateAvailable, updateActive)
                HorizontalDivider(color = V8LineSoft)
                when {
                    updateActive && updateTask != null -> {
                        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        if (updateTask.state == PersistentDownloadState.WAITING_FOR_NETWORK) "Waiting for network" else "Downloading update",
                                        fontFamily = FontFamily.Serif,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 14.sp
                                    )
                                    Text(
                                        buildString {
                                            append(v8FormatBytes(updateTask.downloaded))
                                            if (updateTask.total > 0) append(" / ${v8FormatBytes(updateTask.total)}")
                                            if (updateTask.bytesPerSecond > 0) append(" · ${v8FormatBytes(updateTask.bytesPerSecond)}/s")
                                        },
                                        color = V8Muted,
                                        fontSize = 11.sp
                                    )
                                }
                                Text(if (updateTask.total > 0) "${(updateProgress * 100).roundToInt()}%" else "…", fontSize = 12.sp)
                                TextButton(onClick = onCancelUpdate) { Text("Cancel") }
                            }
                            V8Progress(updateProgress, Modifier.padding(top = 7.dp), success = true)
                        }
                    }
                    state.downloadedApkPath != null -> V8SettingsActionRow(
                        icon = Icons.Outlined.SystemUpdateAlt,
                        title = "Install downloaded update",
                        detail = state.updateInfo?.version ?: "Ready to install",
                        onClick = onInstallUpdate
                    )
                    state.updateAvailable -> V8SettingsActionRow(
                        icon = Icons.Outlined.Download,
                        title = "Download ${state.updateInfo?.version ?: "new version"}",
                        detail = state.updateMessage,
                        onClick = onDownloadUpdate
                    )
                    else -> V8SettingsActionRow(
                        icon = Icons.Outlined.Refresh,
                        title = if (state.updateChecking) "Checking for updates…" else "Check for updates",
                        detail = state.updateMessage,
                        enabled = !state.updateChecking,
                        onClick = onCheckUpdate
                    )
                }
            }
        }

        item { V8SectionTitle("BACKGROUND DOWNLOADS") }
        item {
            V8Group {
                V8SettingsSwitchRow("Auto download on Wi-Fi", "Use Wi-Fi for new PDF versions", wifiOnly) { wifiOnly = it }
                HorizontalDivider(modifier = Modifier.padding(start = 14.dp), color = V8LineSoft)
                V8SettingsSwitchRow("Download while charging", "Allow large background downloads", chargingOnly) { chargingOnly = it }
            }
        }

        item { V8SectionTitle("OFFLINE STORAGE") }
        item {
            V8Group {
                V8SettingsActionRow(
                    icon = Icons.Outlined.DeleteOutline,
                    title = "Clear cached thumbnails",
                    detail = "Temporary cache · ${v8FormatBytes(state.pdfCacheBytes)}",
                    onClick = { clearCacheVisible = true }
                )
                HorizontalDivider(modifier = Modifier.padding(start = 14.dp), color = V8LineSoft)
                V8SettingsActionRow(
                    icon = Icons.Outlined.Folder,
                    title = "Manage offline files",
                    detail = "${state.offlineDocuments.size} PDFs · ${v8FormatBytes(state.offlinePdfBytes)}",
                    onClick = onManageOffline
                )
            }
        }

        item { V8SectionTitle("READING PREFERENCES") }
        item {
            V8Group {
                V8SettingsValueRow("Default PDF view", if (singlePage) "Single Page" else "Continuous") {
                    singlePage = !singlePage
                    onNotice(if (singlePage) "Single Page" else "Continuous")
                }
                HorizontalDivider(modifier = Modifier.padding(start = 14.dp), color = V8LineSoft)
                V8SettingsSwitchRow("Restore reading position", "Continue where you left off", restorePosition) { restorePosition = it }
                HorizontalDivider(modifier = Modifier.padding(start = 14.dp), color = V8LineSoft)
                V8SettingsValueRow("Text scaling", "$textScale%") {
                    textScale = when (textScale) { 90 -> 100; 100 -> 110; 110 -> 120; else -> 90 }
                    onNotice("Text scaling $textScale%")
                }
            }
        }

        item { V8SectionTitle("ABOUT") }
        item {
            V8Group {
                V8SettingsActionRow(Icons.Outlined.Info, "Read-only mode", "GitHub files are never modified") { aboutVisible = true }
                HorizontalDivider(modifier = Modifier.padding(start = 14.dp), color = V8LineSoft)
                V8SettingsValueRow("Version", state.currentVersion) { aboutVisible = true }
            }
        }
    }
}

@Composable
private fun V8SettingsBrandRow(version: String, updateAvailable: Boolean, downloading: Boolean) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(11.dp), color = V8Ink, contentColor = Color.White) {
            Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
                Text("TeX", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            }
        }
        Column(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text("TeXFlow Mobile", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text("Version $version", color = V8Muted, fontSize = 11.sp)
        }
        Surface(shape = CircleShape, color = if (updateAvailable || downloading) Color(0xFFFFF4D6) else Color(0xFFEEF8EF)) {
            Text(
                when { downloading -> "DOWNLOADING"; updateAvailable -> "UPDATE"; else -> "UP TO DATE" },
                modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                color = if (updateAvailable || downloading) Color(0xFF8A5B00) else V8Success,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun V8SettingsActionRow(
    icon: ImageVector,
    title: String,
    detail: String,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Surface(onClick = onClick, enabled = enabled, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(21.dp), tint = if (enabled) V8Ink else V8Muted)
            Column(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(title, fontFamily = FontFamily.Serif, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = if (enabled) V8Ink else V8Muted)
                Text(detail, color = V8Muted, fontSize = 10.8.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("›", color = V8Muted, fontSize = 20.sp)
        }
    }
}

@Composable
private fun V8SettingsValueRow(title: String, value: String, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, modifier = Modifier.weight(1f), fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 13.5.sp)
            Text(value, color = V8Muted, fontSize = 12.sp)
            Text("›", modifier = Modifier.padding(start = 8.dp), color = V8Muted, fontSize = 20.sp)
        }
    }
}

@Composable
private fun V8SettingsSwitchRow(title: String, detail: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 13.5.sp)
            Text(detail, color = V8Muted, fontSize = 10.8.sp)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun V8TextScreen(state: ViewerUiState, onBack: () -> Unit, onOpenGitHub: () -> Unit) {
    val document = state.document ?: return
    var menuVisible by rememberSaveable { mutableStateOf(false) }
    if (menuVisible) {
        V8GenericDialog(
            title = document.name,
            subtitle = document.path,
            onDismiss = { menuVisible = false }
        ) {
            V8DialogAction(Icons.Outlined.OpenInNew, "Open on GitHub") { menuVisible = false; onOpenGitHub() }
            Text("Read-only preview", modifier = Modifier.padding(vertical = 10.dp), color = V8Muted, fontSize = 12.sp)
        }
    }
    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        V8TopBar(document.name, back = onBack, readerTitle = true) {
            V8IconButton(Icons.Outlined.MoreVert, "File menu") { menuVisible = true }
        }
        Box(modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 8.dp)) {
            val vertical = rememberScrollState()
            val horizontal = rememberScrollState()
            Text(
                document.content,
                modifier = Modifier.fillMaxSize().verticalScroll(vertical).horizontalScroll(horizontal).padding(bottom = 24.dp),
                color = V8Ink,
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp,
                lineHeight = 20.sp,
                softWrap = false
            )
        }
    }
}

@Composable
private fun V8TransferToast(
    transfer: TransferUiState,
    onOpen: () -> Unit,
    onHide: () -> Unit,
    onCancel: () -> Unit,
    hazeState: HazeState,
    modifier: Modifier = Modifier
) {
    val determinate = transfer.total > 0
    val progress = if (determinate) (transfer.downloaded.toFloat() / transfer.total.toFloat()).coerceIn(0f, 1f) else 0f
    LiquidGlassSurface(
        onClick = onOpen,
        onClickLabel = "Open downloads",
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(19.dp),
        elevation = 8.dp,
        hazeState = hazeState,
        contentPadding = PaddingValues(horizontal = 13.dp, vertical = 10.dp)
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(transfer.label, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        when {
                            transfer.waitingForNetwork -> "Waiting for network · progress saved"
                            determinate -> "${v8FormatBytes(transfer.downloaded)} / ${v8FormatBytes(transfer.total)}" +
                                if (transfer.bytesPerSecond > 0) " · ${v8FormatBytes(transfer.bytesPerSecond)}/s" else ""
                            else -> "Connecting…"
                        },
                        color = V8Muted,
                        fontSize = 10.5.sp,
                        maxLines = 1
                    )
                }
                if (determinate) Text("${(progress * 100).roundToInt()}%", fontSize = 11.sp)
                V8IconButton(Icons.Outlined.Pause, "Cancel download", onCancel)
                V8IconButton(Icons.Outlined.MoreVert, "Hide download progress", onHide)
            }
            V8Progress(progress, success = true)
        }
    }
}

private fun v8FormatBytes(bytes: Long): String {
    if (bytes <= 0L) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var index = 0
    while (value >= 1024.0 && index < units.lastIndex) {
        value /= 1024.0
        index++
    }
    return if (index == 0) "${value.roundToInt()} ${units[index]}" else String.format(Locale.US, if (value >= 10) "%.1f %s" else "%.2f %s", value, units[index])
}

private fun v8FormatDownloadTime(timestamp: Long): String {
    if (timestamp <= 0L) return "Downloaded"
    val elapsed = System.currentTimeMillis() - timestamp
    return when {
        elapsed < 60_000L -> "Just now"
        elapsed < 3_600_000L -> "${elapsed / 60_000L} min ago"
        elapsed < 86_400_000L -> "${elapsed / 3_600_000L} hr ago"
        else -> SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(timestamp))
    }
}
