package com.zqy.latexviewer.ui

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zqy.latexviewer.model.GitHubContent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import kotlin.math.min
import kotlin.math.sqrt

private data class PdfRendererHandle(
    val descriptor: ParcelFileDescriptor,
    val renderer: PdfRenderer
)

@Composable
internal fun PdfPreviewScreen(
    state: ViewerUiState,
    onDownload: (GitHubContent) -> Unit,
    onRetry: () -> Unit,
    onOpenExternal: () -> Unit,
    onPageChanged: (pageIndex: Int, pageCount: Int) -> Unit
) {
    val document = state.pdfDocument ?: return
    val sourceItem = state.contents.firstOrNull { it.path == document.path }
    val context = LocalContext.current
    val handleResult by produceState<Result<PdfRendererHandle>?>(
        initialValue = null,
        document.localPath,
        document.contentUri,
        document.openedAt
    ) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                val descriptor = document.localPath?.let {
                    val source = File(it)
                    require(source.isFile && source.length() > 0) { "PDF 缓存文件不存在或为空" }
                    ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY)
                } ?: document.contentUri?.let {
                    context.contentResolver.openFileDescriptor(Uri.parse(it), "r")
                } ?: throw IllegalStateException("找不到 PDF 文件")
                try {
                    PdfRendererHandle(descriptor, PdfRenderer(descriptor))
                } catch (failure: Throwable) {
                    runCatching { descriptor.close() }
                    throw failure
                }
            }
        }
    }
    val handle = handleResult?.getOrNull()
    val loadingDocument = handleResult == null
    val openFailure = handleResult?.exceptionOrNull()
    val pageCount = handle?.renderer?.pageCount?.coerceAtLeast(0) ?: 0
    val listState = remember(document.openedAt, pageCount) {
        LazyListState(
            firstVisibleItemIndex = if (pageCount > 0) {
                document.initialPage.coerceIn(0, pageCount - 1)
            } else {
                0
            }
        )
    }
    val currentPage = if (pageCount > 0) {
        listState.firstVisibleItemIndex.coerceIn(0, pageCount - 1)
    } else {
        0
    }

    LaunchedEffect(document.sha, handle) {
        if (handle == null || pageCount <= 0) return@LaunchedEffect
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { page ->
                onPageChanged(page.coerceIn(0, pageCount - 1), pageCount)
            }
    }

    DisposableEffect(handle) {
        onDispose {
            handle?.let {
                synchronized(it.renderer) {
                    runCatching { it.renderer.close() }
                    runCatching { it.descriptor.close() }
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceVariant)
    ) {
        PdfReaderToolbar(
            loading = loadingDocument,
            pageCount = pageCount,
            currentPage = currentPage,
            canDownload = sourceItem != null,
            documentName = document.name,
            onDownload = { sourceItem?.let(onDownload) },
            onOpenExternal = onOpenExternal
        )

        when {
            loadingDocument -> PdfStatusPane(
                loading = true,
                title = "正在打开 PDF",
                message = "正在校验文件并准备页面，请稍候。"
            )

            handle == null -> PdfStatusPane(
                title = "PDF 打开失败",
                message = pdfOpenFailureMessage(openFailure),
                primaryAction = "重新下载",
                onPrimaryAction = onRetry,
                secondaryAction = "用其他应用打开",
                onSecondaryAction = onOpenExternal
            )

            pageCount <= 0 -> PdfStatusPane(
                title = "没有可显示的页面",
                message = "文件可能已损坏，或使用了内置查看器不支持的 PDF 格式。",
                primaryAction = "重新下载",
                onPrimaryAction = onRetry,
                secondaryAction = "用其他应用打开",
                onSecondaryAction = onOpenExternal
            )

            else -> LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(count = pageCount, key = { it }) { pageIndex ->
                    PdfPage(handle.renderer, pageIndex, onOpenExternal)
                }
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 12.dp, bottom = 24.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Outlined.CheckCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "已读完全部 " + pageCount + " 页",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PdfReaderToolbar(
    loading: Boolean,
    pageCount: Int,
    currentPage: Int,
    canDownload: Boolean,
    documentName: String,
    onDownload: () -> Unit,
    onOpenExternal: () -> Unit
) {
    val status = when {
        loading -> "正在打开"
        pageCount <= 0 -> "PDF"
        else -> "第 " + (currentPage + 1) + " / " + pageCount + " 页"
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant
                ) {
                    Text(
                        status,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(Modifier.weight(1f))
                if (canDownload) {
                    IconButton(
                        onClick = onDownload,
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(
                            Icons.Outlined.Download,
                            contentDescription = "下载 " + documentName
                        )
                    }
                }
                IconButton(
                    onClick = onOpenExternal,
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        Icons.Outlined.OpenInNew,
                        contentDescription = "使用其他 PDF 应用打开"
                    )
                }
            }
            if (pageCount > 0) {
                LinearProgressIndicator(
                    progress = { (currentPage + 1).toFloat() / pageCount.toFloat() },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(2.dp),
                    color = MaterialTheme.colorScheme.secondary,
                    trackColor = MaterialTheme.colorScheme.outlineVariant
                )
            }
        }
    }
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
                modifier = Modifier.size(64.dp),
                shape = CircleShape,
                color = if (loading) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.errorContainer
                }
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(28.dp),
                            strokeWidth = 2.5.dp,
                            color = MaterialTheme.colorScheme.secondary
                        )
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
                        .height(48.dp)
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
                        .height(48.dp)
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
    is SecurityException -> "这个 PDF 受到密码或安全策略保护，Android 内置查看器无法直接打开。"
    is IllegalArgumentException -> "PDF 文件无法随机读取。请重新下载，应用会先保存到本地缓存再打开。"
    is IOException -> "PDF 文件不完整或格式损坏。请检查 GitHub 上的成品文件并重新下载。"
    else -> failure?.message?.takeIf { it.isNotBlank() }
        ?: "Android 内置查看器无法读取这个文件，请刷新后重新下载。"
}

@Composable
private fun PdfPage(renderer: PdfRenderer, pageIndex: Int, onOpenExternal: () -> Unit) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val density = LocalDensity.current
        val requestedWidth = with(density) { maxWidth.roundToPx() }.coerceAtLeast(1)
        var retryGeneration by remember(renderer, pageIndex, requestedWidth) { mutableIntStateOf(0) }
        val renderResult by produceState<Result<Bitmap>?>(
            initialValue = null,
            renderer,
            pageIndex,
            requestedWidth,
            retryGeneration
        ) {
            value = withContext(Dispatchers.IO) {
                runCatching {
                    synchronized(renderer) {
                        renderer.openPage(pageIndex).use { page ->
                            val (targetWidth, targetHeight) = calculateRenderSize(
                                page.width,
                                page.height,
                                requestedWidth
                            )
                            Bitmap.createBitmap(
                                targetWidth,
                                targetHeight,
                                Bitmap.Config.ARGB_8888
                            ).also { image ->
                                image.eraseColor(AndroidColor.WHITE)
                                try {
                                    page.render(
                                        image,
                                        null,
                                        null,
                                        PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY
                                    )
                                } catch (failure: Throwable) {
                                    image.recycle()
                                    throw failure
                                }
                            }
                        }
                    }
                }
            }
        }
        val bitmap = renderResult?.getOrNull()

        DisposableEffect(bitmap) {
            onDispose { bitmap?.takeUnless(Bitmap::isRecycled)?.recycle() }
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(6.dp),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 1.dp
        ) {
            val page = bitmap
            when {
                renderResult == null -> Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(DEFAULT_PAGE_ASPECT_RATIO),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(modifier = Modifier.size(26.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "正在渲染第 " + (pageIndex + 1) + " 页",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }

                page == null -> Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        Icons.Outlined.PictureAsPdf,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(30.dp)
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "第 " + (pageIndex + 1) + " 页渲染失败",
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "这一页可能过大、损坏，或采用系统不支持的 PDF 格式。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(16.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedButton(
                            onClick = { retryGeneration += 1 },
                            modifier = Modifier.height(48.dp)
                        ) {
                            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("重试本页")
                        }
                        TextButton(
                            onClick = onOpenExternal,
                            modifier = Modifier.height(48.dp)
                        ) {
                            Text("其他应用打开")
                        }
                    }
                }

                else -> Image(
                    bitmap = page.asImageBitmap(),
                    contentDescription = "第 " + (pageIndex + 1) + " 页",
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(page.width.toFloat() / page.height.toFloat())
                        .background(Color.White),
                    contentScale = ContentScale.FillWidth
                )
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
    val targetWidth = (pageWidth * scale).toInt().coerceAtLeast(1)
    val proportionalHeight = (pageHeight * scale).toInt().coerceAtLeast(1)
    val pixelBoundHeight = (maximumPixels / targetWidth).toInt().coerceAtLeast(1)
    return targetWidth to min(proportionalHeight, pixelBoundHeight)
}

private const val DEFAULT_PAGE_ASPECT_RATIO = 0.707f
private const val MAX_RENDER_WIDTH = 1200
private const val MAX_RENDER_PIXELS = 2_400_000L
