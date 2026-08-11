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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zqy.latexviewer.model.GitHubContent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

private data class PdfRendererHandle(
    val descriptor: ParcelFileDescriptor,
    val renderer: PdfRenderer
)

@Composable
internal fun PdfPreviewScreen(
    state: ViewerUiState,
    onDownload: (GitHubContent) -> Unit,
    onPageChanged: (pageIndex: Int, pageCount: Int) -> Unit
) {
    val document = state.pdfDocument ?: return
    val sourceItem = state.contents.firstOrNull { it.path == document.path }
    val context = LocalContext.current
    val handleResult by produceState<Result<PdfRendererHandle>?>(
        initialValue = null,
        document.localPath,
        document.contentUri
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
    val pageCount = handle?.renderer?.pageCount ?: 1
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = document.initialPage.coerceAtLeast(0)
    )
    val currentPage = listState.firstVisibleItemIndex.coerceIn(0, pageCount - 1)

    LaunchedEffect(document.sha, handle) {
        if (handle == null) return@LaunchedEffect
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { page -> onPageChanged(page.coerceIn(0, pageCount - 1), pageCount) }
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
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Outlined.PictureAsPdf,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(19.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    loadingDocument -> "正在打开 PDF…"
                    handle == null -> "PDF 读取失败"
                    else -> "第 ${currentPage + 1} / ${handle.renderer.pageCount} 页"
                },
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
            if (sourceItem != null) {
                IconButton(onClick = { onDownload(sourceItem) }) {
                    Icon(Icons.Outlined.Download, contentDescription = "下载 ${document.name}")
                }
            }
        }
        Spacer(Modifier.height(6.dp))

        if (loadingDocument) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceVariant
            ) {
                Row(
                    modifier = Modifier.padding(20.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("正在校验并加载 PDF，请稍候")
                }
            }
        } else if (handle == null) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.errorContainer
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("PDF 打开失败", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(5.dp))
                    Text(
                        pdfOpenFailureMessage(openFailure),
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items((0 until handle.renderer.pageCount).toList(), key = { it }) { pageIndex ->
                    PdfPage(handle.renderer, pageIndex)
                }
                item {
                    Text(
                        "已到文档末尾",
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 16.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}

private fun pdfOpenFailureMessage(failure: Throwable?): String = when (failure) {
    is SecurityException -> "这个 PDF 受到密码或安全策略保护，Android 内置查看器无法直接打开。你仍可下载后使用其他 PDF 应用查看。"
    is IllegalArgumentException -> "PDF 文件不可随机读取。请返回后重新下载，应用会先复制到本地缓存再打开。"
    is IOException -> "PDF 文件不完整或格式损坏。请检查 GitHub 上的成品文件并重新下载。"
    else -> failure?.message?.takeIf { it.isNotBlank() }
        ?: "Android 内置解析器无法读取此文件，请刷新后重新下载。"
}

@Composable
private fun PdfPage(renderer: PdfRenderer, pageIndex: Int) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val density = LocalDensity.current
        val targetWidth = with(density) { maxWidth.roundToPx() }.coerceIn(1, 1600)
        val bitmap by produceState<Bitmap?>(
            initialValue = null,
            renderer,
            pageIndex,
            targetWidth
        ) {
            value = withContext(Dispatchers.IO) {
                synchronized(renderer) {
                    renderer.openPage(pageIndex).use { page ->
                        val targetHeight = (targetWidth.toLong() * page.height / page.width)
                            .toInt()
                            .coerceAtLeast(1)
                        Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888).also { image ->
                            image.eraseColor(AndroidColor.WHITE)
                            page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        }
                    }
                }
            }
        }

        DisposableEffect(bitmap) {
            onDispose { bitmap?.recycle() }
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(10.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
            val page = bitmap
            if (page == null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(420.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(26.dp), strokeWidth = 2.dp)
                }
            } else {
                Image(
                    bitmap = page.asImageBitmap(),
                    contentDescription = "第 ${pageIndex + 1} 页",
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(page.width.toFloat() / page.height.toFloat())
                        .background(androidx.compose.ui.graphics.Color.White),
                    contentScale = ContentScale.FillWidth
                )
            }
        }
    }
}
