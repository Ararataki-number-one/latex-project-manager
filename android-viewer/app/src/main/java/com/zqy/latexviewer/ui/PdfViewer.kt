package com.zqy.latexviewer.ui

import android.app.ActivityManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ZoomOutMap
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.PdfBookmark
import io.legere.pdfiumandroid.PdfDocument as PdfiumDocument
import io.legere.pdfiumandroid.PdfiumCore
import io.legere.pdfiumandroid.api.Bookmark as PdfiumBookmark
import io.legere.pdfiumandroid.api.Size as PdfiumSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.util.LinkedHashMap
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

private data class PdfOutlineEntry(
    val title: String,
    val pageIndex: Int,
    val depth: Int
)

private data class PdfiumDocumentHandle(
    val descriptor: ParcelFileDescriptor,
    val document: PdfiumDocument,
    val pageSizes: List<PdfiumSize>,
    val outline: List<PdfOutlineEntry>
) : Closeable {
    val pageCount: Int get() = pageSizes.size

    override fun close() {
        runCatching { document.close() }
        runCatching { descriptor.close() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PdfPreviewScreen(
    state: ViewerUiState,
    onBack: () -> Unit,
    onDownload: () -> Unit,
    onRetry: () -> Unit,
    onOpenExternal: () -> Unit,
    onOpenGitHub: () -> Unit,
    onKeepOffline: () -> Unit,
    onRemoveOffline: () -> Unit,
    onPageChanged: (pageIndex: Int, pageCount: Int) -> Unit,
    bookmarks: List<PdfBookmark> = emptyList(),
    onToggleBookmark: (pageIndex: Int, pageCount: Int) -> Unit = { _, _ -> }
) {
    val source = state.pdfDocument ?: return
    val sourceItem = state.currentPdfSource
    val context = LocalContext.current
    val documentKey = remember(source.repositoryFullName, source.path, source.sha, source.openedAt) {
        listOf(source.repositoryFullName.orEmpty(), source.path, source.sha.orEmpty(), source.openedAt.toString())
            .joinToString("|")
    }
    val handleResult by produceState<Result<PdfiumDocumentHandle>?>(
        initialValue = null,
        documentKey,
        source.localPath,
        source.contentUri
    ) {
        value = withContext(Dispatchers.IO) {
            runCatching { openPdfiumDocument(context.applicationContext, source.localPath, source.contentUri) }
        }
    }
    val handle = handleResult?.getOrNull()
    val failure = handleResult?.exceptionOrNull()
    val pageCount = handle?.pageCount ?: 0
    val lowRam = remember(context) {
        context.getSystemService(ActivityManager::class.java)?.isLowRamDevice == true
    }
    val bitmapCache = remember(handle, lowRam) {
        handle?.let {
            PdfPageBitmapCache(
                document = it.document,
                maximumBytes = if (lowRam) LOW_RAM_BITMAP_CACHE_BYTES else BITMAP_CACHE_BYTES,
                maximumPixels = if (lowRam) LOW_RAM_RENDER_PIXELS else MAX_RENDER_PIXELS
            )
        }
    }
    val listState = rememberSaveable(documentKey, pageCount, saver = LazyListState.Saver) {
        LazyListState(
            firstVisibleItemIndex = if (pageCount > 0) source.initialPage.coerceIn(0, pageCount - 1) else 0
        )
    }
    var controlsVisible by rememberSaveable(documentKey) { mutableStateOf(true) }
    var zoom by rememberSaveable(documentKey) { mutableFloatStateOf(MIN_PDF_ZOOM) }
    var navigatorVisible by rememberSaveable(documentKey) { mutableStateOf(false) }
    var pageJumpVisible by rememberSaveable(documentKey) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val currentPage by remember(listState, pageCount) {
        derivedStateOf { centeredVisiblePage(listState, pageCount) }
    }
    val documentBookmarks = remember(bookmarks, source.repositoryFullName, source.path) {
        bookmarks
            .filter {
                it.repositoryFullName.equals(source.repositoryFullName, ignoreCase = true) &&
                    normalizePdfPath(it.pdfPath) == normalizePdfPath(source.path)
            }
            .sortedBy(PdfBookmark::pageIndex)
    }
    val currentPageBookmarked = documentBookmarks.any { it.pageIndex == currentPage }

    LaunchedEffect(source.sha, handle, pageCount) {
        if (handle == null || pageCount <= 0) return@LaunchedEffect
        snapshotFlow { centeredVisiblePage(listState, pageCount) }
            .distinctUntilChanged()
            .collect { page -> onPageChanged(page, pageCount) }
    }

    DisposableEffect(handle, bitmapCache) {
        onDispose {
            bitmapCache?.close()
            handle?.close()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        when {
            handleResult == null -> PdfStatusPane(
                loading = true,
                title = "正在打开 PDF",
                message = "正在检查文档并准备页面"
            )

            handle == null || bitmapCache == null -> PdfStatusPane(
                title = "无法打开 PDF",
                message = pdfOpenFailureMessage(failure),
                primaryAction = "重新下载",
                onPrimaryAction = onRetry,
                secondaryAction = "用其他应用打开",
                onSecondaryAction = onOpenExternal
            )

            pageCount <= 0 -> PdfStatusPane(
                title = "文档没有可显示的页面",
                message = "文件可能不完整、已加密，或使用了当前查看器不支持的格式。",
                primaryAction = "重新下载",
                onPrimaryAction = onRetry,
                secondaryAction = "用其他应用打开",
                onSecondaryAction = onOpenExternal
            )

            else -> LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 26.dp,
                    top = 98.dp,
                    end = 26.dp,
                    bottom = 24.dp
                ),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                items(count = pageCount, key = { index -> "$documentKey:$index" }) { pageIndex ->
                    PdfiumPage(
                        pageIndex = pageIndex,
                        pageSize = handle.pageSizes[pageIndex],
                        zoom = zoom,
                        cache = bitmapCache,
                        onZoomChange = { zoom = clampPdfZoom(zoom * it) },
                        onToggleControls = { controlsVisible = !controlsVisible },
                        onDoubleTap = {
                            zoom = if (zoom > MIN_PDF_ZOOM + 0.05f) MIN_PDF_ZOOM else DOUBLE_TAP_PDF_ZOOM
                        }
                    )
                }
            }
        }

        AnimatedVisibility(
            visible = controlsVisible,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(horizontal = 14.dp, vertical = 6.dp),
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            PdfFloatingToolbar(
                documentName = source.name,
                sourceItem = sourceItem,
                bookmarked = currentPageBookmarked,
                onBack = onBack,
                onToggleBookmark = { if (pageCount > 0) onToggleBookmark(currentPage, pageCount) },
                onDownload = onDownload,
                onOpenExternal = onOpenExternal,
                onOpenGitHub = onOpenGitHub,
                offline = state.currentPdfOffline,
                onKeepOffline = onKeepOffline,
                onRemoveOffline = onRemoveOffline,
                outlineAvailable = handle?.outline?.isNotEmpty() == true,
                zoomed = zoom > MIN_PDF_ZOOM + 0.01f,
                onOpenNavigator = { navigatorVisible = true },
                onOpenPageJump = { pageJumpVisible = true },
                onResetZoom = { zoom = MIN_PDF_ZOOM }
            )
        }

        if (pageCount > 0 && handle != null) {
            AnimatedVisibility(
                visible = controlsVisible,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(start = 26.dp, top = 61.dp),
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                Surface(
                    onClick = { pageJumpVisible = true },
                    shape = RoundedCornerShape(8.dp),
                    color = Color.White,
                    contentColor = Color(0xFF111111),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFECECEA)),
                    shadowElevation = 2.dp
                ) {
                    Text(
                        text = "${currentPage + 1} / $pageCount",
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }

    if (navigatorVisible && handle != null) {
        PdfNavigatorSheet(
            outline = handle.outline,
            bookmarks = documentBookmarks,
            pageCount = pageCount,
            onDismiss = { navigatorVisible = false },
            onPageSelected = { page ->
                navigatorVisible = false
                scope.launch { listState.animateScrollToItem(page.coerceIn(0, pageCount - 1)) }
            }
        )
    }

    if (pageJumpVisible && pageCount > 0) {
        PdfPageJumpDialog(
            currentPage = currentPage,
            pageCount = pageCount,
            onDismiss = { pageJumpVisible = false },
            onJump = { page ->
                pageJumpVisible = false
                scope.launch { listState.animateScrollToItem(page.coerceIn(0, pageCount - 1)) }
            }
        )
    }
}

private fun openPdfiumDocument(
    context: android.content.Context,
    localPath: String?,
    contentUri: String?
): PdfiumDocumentHandle {
    val descriptor = localPath?.let { path ->
        val file = File(path)
        require(file.isFile && file.length() > 0L) { "PDF 缓存文件不存在或为空" }
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    } ?: contentUri?.let { value ->
        context.contentResolver.openFileDescriptor(Uri.parse(value), "r")
    } ?: throw IllegalStateException("找不到 PDF 文件")

    try {
        val document = PdfiumCore(context).newDocument(descriptor)
        try {
            val pageCount = document.getPageCount()
            require(pageCount > 0) { "PDF 文档没有页面" }
            val sizes = runCatching {
                List(pageCount) { pageIndex ->
                    requireNotNull(document.openPage(pageIndex)) {
                        "PDF page ${pageIndex + 1} could not be opened"
                    }.use { page ->
                        page.getPageSize(PDFIUM_LAYOUT_DPI)
                    }
                }
            }
                .getOrElse { emptyList<PdfiumSize>() }
                .takeIf { values ->
                    values.size == pageCount && values.all { it.width > 0 && it.height > 0 }
                }
                ?: List(pageCount) { PdfiumSize(DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT) }
            val outline = runCatching { flattenPdfOutline(document.getTableOfContents(), pageCount) }
                .getOrDefault(emptyList())
            return PdfiumDocumentHandle(descriptor, document, sizes, outline)
        } catch (failure: Throwable) {
            runCatching { document.close() }
            throw failure
        }
    } catch (failure: Throwable) {
        runCatching { descriptor.close() }
        throw failure
    }
}

private fun flattenPdfOutline(
    bookmarks: List<PdfiumBookmark>,
    pageCount: Int
): List<PdfOutlineEntry> {
    val result = ArrayList<PdfOutlineEntry>()
    fun append(values: List<PdfiumBookmark>, depth: Int) {
        if (depth > MAX_OUTLINE_DEPTH || result.size >= MAX_OUTLINE_ITEMS) return
        values.forEach { bookmark ->
            if (result.size >= MAX_OUTLINE_ITEMS) return
            val title = bookmark.title?.trim().orEmpty()
            val page = bookmark.pageIdx.toInt()
            if (title.isNotEmpty() && page in 0 until pageCount) {
                result += PdfOutlineEntry(title, page, depth)
            }
            append(bookmark.children, depth + 1)
        }
    }
    append(bookmarks, 0)
    return result
}

@Composable
private fun PdfFloatingToolbar(
    documentName: String,
    sourceItem: GitHubContent?,
    bookmarked: Boolean,
    onBack: () -> Unit,
    onToggleBookmark: () -> Unit,
    onDownload: () -> Unit,
    onOpenExternal: () -> Unit,
    onOpenGitHub: () -> Unit,
    offline: Boolean,
    onKeepOffline: () -> Unit,
    onRemoveOffline: () -> Unit,
    outlineAvailable: Boolean,
    zoomed: Boolean,
    onOpenNavigator: () -> Unit,
    onOpenPageJump: () -> Unit,
    onResetZoom: () -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 50.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
        }
        Text(
            text = documentName,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        IconButton(onClick = onOpenPageJump, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Outlined.Search, contentDescription = "Find a page")
        }
        IconButton(onClick = onToggleBookmark, modifier = Modifier.size(48.dp)) {
            Icon(
                imageVector = if (bookmarked) Icons.Outlined.Bookmark else Icons.Outlined.BookmarkBorder,
                contentDescription = if (bookmarked) "Remove bookmark" else "Bookmark page",
                tint = MaterialTheme.colorScheme.onSurface
            )
        }
        Box {
            IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "PDF tools")
            }
            DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("Contents & bookmarks") },
                        leadingIcon = { Icon(Icons.Outlined.FormatListBulleted, contentDescription = null) },
                        enabled = outlineAvailable,
                        onClick = { menuExpanded = false; onOpenNavigator() }
                    )
                    if (zoomed) {
                        DropdownMenuItem(
                            text = { Text("Fit to width") },
                            leadingIcon = { Icon(Icons.Outlined.ZoomOutMap, contentDescription = null) },
                            onClick = { menuExpanded = false; onResetZoom() }
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("View on GitHub") },
                        leadingIcon = { Icon(Icons.Outlined.OpenInNew, contentDescription = null) },
                        onClick = { menuExpanded = false; onOpenGitHub() }
                    )
                    DropdownMenuItem(
                        text = { Text("Open in another app") },
                        leadingIcon = { Icon(Icons.Outlined.PictureAsPdf, contentDescription = null) },
                        onClick = { menuExpanded = false; onOpenExternal() }
                    )
                    sourceItem?.let {
                        DropdownMenuItem(
                            text = { Text("Save a copy") },
                            leadingIcon = { Icon(Icons.Outlined.Download, contentDescription = null) },
                            onClick = { menuExpanded = false; onDownload() }
                        )
                    }
                    DropdownMenuItem(
                        text = {
                            Text(if (offline) "Remove offline copy" else "Keep offline")
                        },
                        leadingIcon = { Icon(Icons.Outlined.Download, contentDescription = null) },
                        onClick = {
                            menuExpanded = false
                            if (offline) onRemoveOffline() else onKeepOffline()
                        }
                    )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PdfNavigatorSheet(
    outline: List<PdfOutlineEntry>,
    bookmarks: List<PdfBookmark>,
    pageCount: Int,
    onDismiss: () -> Unit,
    onPageSelected: (Int) -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 620.dp)
                .padding(horizontal = 20.dp)
        ) {
            Text("文档导航", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(16.dp))
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(bottom = 28.dp)
            ) {
                if (outline.isNotEmpty()) {
                    item {
                        Text(
                            "目录",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                    itemsIndexed(outline, key = { index, item -> "outline:$index:${item.pageIndex}" }) { _, item ->
                        Surface(
                            onClick = { onPageSelected(item.pageIndex) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp),
                            color = Color.Transparent
                        ) {
                            Row(
                                modifier = Modifier.padding(start = (item.depth.coerceAtMost(5) * 16).dp, end = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    item.title,
                                    modifier = Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodyLarge,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    (item.pageIndex + 1).toString(),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.labelLarge
                                )
                            }
                        }
                    }
                }
                if (bookmarks.isNotEmpty()) {
                    item {
                        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
                        Text(
                            "我的书签",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                    items(bookmarks, key = PdfBookmark::stableId) { bookmark ->
                        Surface(
                            onClick = { onPageSelected(bookmark.pageIndex.coerceIn(0, pageCount - 1)) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 52.dp),
                            color = Color.Transparent
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Outlined.Bookmark,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(22.dp)
                                )
                                Spacer(Modifier.width(12.dp))
                                Text(
                                    bookmark.label?.takeIf(String::isNotBlank) ?: "第 ${bookmark.pageIndex + 1} 页",
                                    modifier = Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodyLarge
                                )
                                Text(
                                    (bookmark.pageIndex + 1).toString(),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.labelLarge
                                )
                            }
                        }
                    }
                }
                if (outline.isEmpty() && bookmarks.isEmpty()) {
                    item {
                        PdfStatusPane(
                            title = "还没有导航内容",
                            message = "这个 PDF 没有内置目录。阅读时可以在工具栏中收藏重要页面。"
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PdfPageJumpDialog(
    currentPage: Int,
    pageCount: Int,
    onDismiss: () -> Unit,
    onJump: (Int) -> Unit
) {
    var value by rememberSaveable(currentPage, pageCount) { mutableStateOf((currentPage + 1).toString()) }
    val parsed = value.toIntOrNull()
    val valid = parsed != null && parsed in 1..pageCount
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("跳转到页面") },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { next -> value = next.filter(Char::isDigit).take(6) },
                label = { Text("页码（1–$pageCount）") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                isError = value.isNotEmpty() && !valid,
                supportingText = if (value.isNotEmpty() && !valid) ({ Text("请输入 1 到 $pageCount") }) else null
            )
        },
        confirmButton = {
            TextButton(onClick = { onJump((parsed ?: 1) - 1) }, enabled = valid) { Text("跳转") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun PdfStatusPane(
    title: String,
    message: String,
    loading: Boolean = false,
    primaryAction: String? = null,
    onPrimaryAction: (() -> Unit)? = null,
    secondaryAction: String? = null,
    onSecondaryAction: (() -> Unit)? = null
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp, vertical = 36.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.widthIn(max = 420.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(
                modifier = Modifier.size(60.dp),
                shape = CircleShape,
                color = if (loading) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (loading) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.5.dp)
                    } else {
                        Icon(
                            Icons.Outlined.ErrorOutline,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(30.dp)
                        )
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            Text(
                title,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                message,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center
            )
            if (primaryAction != null && onPrimaryAction != null) {
                Spacer(Modifier.height(24.dp))
                Button(
                    onClick = onPrimaryAction,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(primaryAction)
                }
            }
            if (secondaryAction != null && onSecondaryAction != null) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onSecondaryAction,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(secondaryAction)
                }
            }
        }
    }
}

private fun pdfOpenFailureMessage(failure: Throwable?): String = when (failure) {
    is SecurityException -> "这个 PDF 受到密码或系统安全策略保护。可以尝试使用其他应用打开。"
    is IllegalArgumentException -> "PDF 文件无法随机读取，或文件内容不完整。请重新下载后再试。"
    is IOException -> "PDF 文件不完整、已加密或格式损坏。请重新下载，或使用其他应用打开。"
    is OutOfMemoryError -> "设备内存不足，已停止打开文档。关闭其他应用后重试，或使用外部查看器。"
    else -> failure?.message?.takeIf(String::isNotBlank)
        ?: "内置查看器无法读取这个文件。请重新下载，或使用其他应用打开。"
}

@Composable
private fun PdfiumPage(
    pageIndex: Int,
    pageSize: PdfiumSize,
    zoom: Float,
    cache: PdfPageBitmapCache,
    onZoomChange: (Float) -> Unit,
    onToggleControls: () -> Unit,
    onDoubleTap: () -> Unit
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val fitWidth = minOf(maxWidth, MAX_PAPER_WIDTH)
        val displayWidth = fitWidth * zoom
        val density = LocalDensity.current
        val requestedWidth = with(density) { displayWidth.roundToPx() }.coerceAtLeast(1)
        val pageAspect = safePageAspect(pageSize)
        val horizontalScroll = rememberScrollState()
        var retryGeneration by remember(pageIndex, requestedWidth) { mutableIntStateOf(0) }
        val leaseResult by produceState<Result<PdfBitmapLease>?>(
            initialValue = null,
            cache,
            pageIndex,
            requestedWidth,
            retryGeneration
        ) {
            value = withContext(Dispatchers.IO) {
                runCatching { cache.acquire(pageIndex, requestedWidth) }
            }
        }
        val lease = leaseResult?.getOrNull()

        DisposableEffect(lease) {
            onDispose { lease?.close() }
        }

        LaunchedEffect(zoom) {
            if (zoom <= MIN_PDF_ZOOM + 0.01f) horizontalScroll.scrollTo(0)
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(horizontalScroll),
            horizontalArrangement = Arrangement.Center
        ) {
            Surface(
                modifier = Modifier
                    .width(displayWidth)
                    .aspectRatio(pageAspect)
                    .clip(RoundedCornerShape(PDF_PAGE_RADIUS))
                    .pdfPinchZoom(onZoomChange)
                    .pointerInput(pageIndex, zoom) {
                        detectTapGestures(
                            onTap = { onToggleControls() },
                            onDoubleTap = { onDoubleTap() }
                        )
                    }
                    .semantics {
                        contentDescription = "第 ${pageIndex + 1} 页 PDF 页面"
                    },
                shape = RoundedCornerShape(PDF_PAGE_RADIUS),
                color = Color.White,
                contentColor = Color(0xFF1C1C1E),
                shadowElevation = 1.dp
            ) {
                when {
                    leaseResult == null -> Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(pageAspect)
                            .background(Color.White),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 1.75.dp,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }

                    lease == null -> Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(pageAspect)
                            .background(Color.White)
                            .padding(horizontal = 24.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            "第 ${pageIndex + 1} 页暂时无法显示",
                            color = Color(0xFF666666),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            textAlign = TextAlign.Center
                        )
                        TextButton(
                            onClick = { retryGeneration += 1 },
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("重试")
                        }
                    }

                    else -> Image(
                        bitmap = lease.bitmap.asImageBitmap(),
                        contentDescription = null,
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(lease.bitmap.width.toFloat() / lease.bitmap.height.toFloat())
                            .background(Color.White),
                        contentScale = ContentScale.FillWidth
                    )
                }
            }
        }
    }
}

private fun Modifier.pdfPinchZoom(onZoomChange: (Float) -> Unit): Modifier = pointerInput(onZoomChange) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        var pinching = false
        do {
            val event = awaitPointerEvent(pass = PointerEventPass.Main)
            val pressed = event.changes.count { it.pressed }
            if (pressed >= 2) {
                pinching = true
                val change = event.calculateZoom()
                if (change.isFinite() && change > 0f && abs(change - 1f) > 0.001f) onZoomChange(change)
                event.changes.forEach { it.consume() }
            } else if (pinching) {
                event.changes.forEach { it.consume() }
            }
        } while (event.changes.any { it.pressed })
    }
}

@Stable
private class PdfBitmapLease(
    val bitmap: Bitmap,
    private val onClose: () -> Unit
) : Closeable {
    private var closed = false

    override fun close() {
        if (closed) return
        closed = true
        onClose()
    }
}

private data class PdfBitmapKey(val pageIndex: Int, val width: Int)

private data class PdfBitmapEntry(
    val bitmap: Bitmap,
    var references: Int = 0
)

private class PdfPageBitmapCache(
    private val document: PdfiumDocument,
    private val maximumBytes: Long,
    private val maximumPixels: Long
) : Closeable {
    private val lock = Any()
    private val renderLock = Any()
    private val entries = LinkedHashMap<PdfBitmapKey, PdfBitmapEntry>(8, 0.75f, true)
    private var bytes = 0L
    private var closed = false

    fun acquire(pageIndex: Int, requestedWidth: Int): PdfBitmapLease {
        val widthBucket = ((requestedWidth.coerceAtLeast(1) + RENDER_WIDTH_BUCKET - 1) / RENDER_WIDTH_BUCKET) * RENDER_WIDTH_BUCKET
        val key = PdfBitmapKey(pageIndex, widthBucket.coerceAtMost(MAX_RENDER_WIDTH))
        synchronized(lock) {
            check(!closed) { "PDF 页面缓存已关闭" }
            entries[key]?.takeUnless { it.bitmap.isRecycled }?.let { entry ->
                entry.references += 1
                return lease(key, entry)
            }
        }

        val rendered = render(pageIndex, key.width)
        synchronized(lock) {
            if (closed) {
                rendered.recycle()
                throw IllegalStateException("PDF 页面缓存已关闭")
            }
            entries[key]?.takeUnless { it.bitmap.isRecycled }?.let { existing ->
                rendered.recycle()
                existing.references += 1
                return lease(key, existing)
            }
            val entry = PdfBitmapEntry(rendered, references = 1)
            entries[key] = entry
            bytes += rendered.allocationByteCount.toLong()
            trimLocked()
            return lease(key, entry)
        }
    }

    private fun render(pageIndex: Int, requestedWidth: Int): Bitmap = synchronized(renderLock) {
        // acquire() may have passed its first closed check before close() won the
        // render lock. Recheck while holding the same lock used by close() before
        // entering Pdfium native code.
        synchronized(lock) {
            check(!closed) { "PDF 页面缓存已关闭" }
        }
        val page = document.openPage(pageIndex) ?: throw IOException("第 ${pageIndex + 1} 页无法加载")
        page.use {
            val (targetWidth, targetHeight) = calculateRenderSize(
                pageWidth = it.getPageWidthPoint(),
                pageHeight = it.getPageHeightPoint(),
                requestedWidth = requestedWidth,
                maximumWidth = MAX_RENDER_WIDTH,
                maximumPixels = maximumPixels
            )
            Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888).also { bitmap ->
                try {
                    it.renderPageBitmap(
                        bitmap = bitmap,
                        startX = 0,
                        startY = 0,
                        drawSizeX = targetWidth,
                        drawSizeY = targetHeight,
                        renderAnnot = true,
                        canvasColor = android.graphics.Color.WHITE,
                        pageBackgroundColor = android.graphics.Color.WHITE
                    )
                } catch (failure: Throwable) {
                    bitmap.recycle()
                    throw failure
                }
            }
        }
    }

    private fun lease(key: PdfBitmapKey, entry: PdfBitmapEntry): PdfBitmapLease =
        PdfBitmapLease(entry.bitmap) { release(key, entry.bitmap) }

    private fun release(key: PdfBitmapKey, bitmap: Bitmap) {
        synchronized(lock) {
            val entry = entries[key]
            if (entry != null && entry.bitmap === bitmap) {
                entry.references = (entry.references - 1).coerceAtLeast(0)
                // A document can leave composition while a page Image still owns
                // its final frame. Do not recycle that bitmap from close(); retire
                // it when the last lease is actually released instead.
                if (closed && entry.references == 0) {
                    entries.remove(key)
                    bytes -= entry.bitmap.allocationByteCount.toLong()
                    entry.bitmap.takeUnless(Bitmap::isRecycled)?.recycle()
                    return
                }
            }
            trimLocked()
        }
    }

    private fun trimLocked() {
        if (bytes <= maximumBytes) return
        val iterator = entries.entries.iterator()
        while (bytes > maximumBytes && iterator.hasNext()) {
            val entry = iterator.next().value
            if (entry.references > 0) continue
            iterator.remove()
            bytes -= entry.bitmap.allocationByteCount.toLong()
            entry.bitmap.takeUnless(Bitmap::isRecycled)?.recycle()
        }
    }

    override fun close() {
        // Pdfium is native code. Closing the PdfDocument while renderPageBitmap is
        // running can crash the process rather than throw a Kotlin exception. Take
        // the render lock first so PdfPreviewScreen may safely close the document
        // immediately after this cache has drained active native rendering.
        synchronized(renderLock) {
            synchronized(lock) {
                if (closed) return
                closed = true
                val iterator = entries.entries.iterator()
                while (iterator.hasNext()) {
                    val entry = iterator.next().value
                    if (entry.references > 0) continue
                    iterator.remove()
                    bytes -= entry.bitmap.allocationByteCount.toLong()
                    entry.bitmap.takeUnless(Bitmap::isRecycled)?.recycle()
                }
            }
        }
    }
}

internal fun calculateRenderSize(
    pageWidth: Int,
    pageHeight: Int,
    requestedWidth: Int,
    maximumWidth: Int = MAX_RENDER_WIDTH,
    maximumPixels: Long = MAX_RENDER_PIXELS
): Pair<Int, Int> {
    require(pageWidth > 0 && pageHeight > 0 && requestedWidth > 0)
    val widthScale = min(requestedWidth, maximumWidth).toDouble() / pageWidth.toDouble()
    val pixelScale = sqrt(maximumPixels.toDouble() / (pageWidth.toLong() * pageHeight.toLong()).toDouble())
    val scale = min(widthScale, pixelScale).coerceAtLeast(1.0 / maxOf(pageWidth, pageHeight))
    val targetWidth = (pageWidth * scale).roundToInt().coerceAtLeast(1)
    val proportionalHeight = (pageHeight * scale).roundToInt().coerceAtLeast(1)
    val pixelBoundHeight = (maximumPixels / targetWidth).toInt().coerceAtLeast(1)
    return targetWidth to min(proportionalHeight, pixelBoundHeight)
}

internal fun clampPdfZoom(value: Float): Float = value.coerceIn(MIN_PDF_ZOOM, MAX_PDF_ZOOM)

private fun centeredVisiblePage(state: LazyListState, pageCount: Int): Int {
    if (pageCount <= 0) return 0
    val layout = state.layoutInfo
    val viewportCenter = (layout.viewportStartOffset + layout.viewportEndOffset) / 2
    return layout.visibleItemsInfo
        .minByOrNull { item -> abs((item.offset + item.size / 2) - viewportCenter) }
        ?.index
        ?.coerceIn(0, pageCount - 1)
        ?: state.firstVisibleItemIndex.coerceIn(0, pageCount - 1)
}

private fun normalizePdfPath(path: String): String = path.replace('\\', '/').trimStart('/')

private fun safePageAspect(size: PdfiumSize): Float {
    if (size.width <= 0 || size.height <= 0) return DEFAULT_PAGE_ASPECT_RATIO
    return (size.width.toFloat() / size.height.toFloat()).coerceIn(0.2f, 5f)
}

private const val PDFIUM_LAYOUT_DPI = 72
private const val DEFAULT_PAGE_WIDTH = 595
private const val DEFAULT_PAGE_HEIGHT = 842
private const val DEFAULT_PAGE_ASPECT_RATIO = 0.707f
private const val MIN_PDF_ZOOM = 1f
private const val DOUBLE_TAP_PDF_ZOOM = 2f
private const val MAX_PDF_ZOOM = 3.5f
private const val MAX_RENDER_WIDTH = 1800
private const val RENDER_WIDTH_BUCKET = 96
private const val MAX_RENDER_PIXELS = 3_200_000L
private const val LOW_RAM_RENDER_PIXELS = 1_800_000L
private const val BITMAP_CACHE_BYTES = 32L * 1024 * 1024
private const val LOW_RAM_BITMAP_CACHE_BYTES = 16L * 1024 * 1024
private const val MAX_OUTLINE_DEPTH = 16
private const val MAX_OUTLINE_ITEMS = 1_500
private val PDF_PAGE_GUTTER = 6.dp
private val PDF_PAGE_RADIUS = 2.dp
private val MAX_PAPER_WIDTH = 920.dp
