package com.zqy.latexviewer.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.DownloadedFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.security.MessageDigest

class DownloadStore(private val context: Context) {
    fun stagingFile(taskId: String): File {
        val safeId = taskId.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
        val directory = File(context.cacheDir, "background-downloads").apply { mkdirs() }
        return File(directory, "${safeId.ifBlank { "download" }}.part")
    }

    fun discardStaging(file: File) {
        runCatching { if (file.isFile) file.delete() }
    }

    suspend fun publishPublicDownloadFromFile(
        displayName: String,
        mimeType: String,
        source: File
    ): DownloadedFile = withContext(Dispatchers.IO) {
        require(source.isFile && source.length() > 0) { "下载文件为空或已经丢失" }
        val downloaded = savePublicDownload(displayName, mimeType) { output ->
            source.inputStream().use { input -> input.copyTo(output, COPY_BUFFER_BYTES) }
        }
        source.delete()
        downloaded
    }

    suspend fun commitPdfPreviewFromFile(
        cacheKey: String,
        maxCacheBytes: Long = DEFAULT_PDF_CACHE_BYTES,
        source: File
    ): File = withContext(Dispatchers.IO) {
        val directory = pdfCacheDirectory()
        val fileName = pdfCacheName(cacheKey)
        val destination = File(directory, fileName)
        try {
            validatePdf(source)
            if (destination.exists() && !destination.delete()) {
                throw IllegalStateException("无法替换 PDF 预览缓存")
            }
            moveOrCopy(source, destination)
            destination.setLastModified(System.currentTimeMillis())
            trimPdfCache(directory, destination, maxCacheBytes)
            destination
        } catch (failure: Throwable) {
            source.delete()
            throw failure
        }
    }

    suspend fun commitUpdateFromFile(asset: AndroidReleaseAsset, source: File): File = withContext(Dispatchers.IO) {
        val directory = updateDirectory().apply { mkdirs() }
        val destination = File(directory, safeName(asset.name))
        try {
            require(source.isFile && source.length() > 0) { "更新包为空或已经丢失" }
            if (asset.size > 0 && source.length() != asset.size) {
                throw IllegalStateException("更新包大小校验失败，请重新下载")
            }
            verifyDigest(source, asset.sha256)
            if (destination.exists() && !destination.delete()) {
                throw IllegalStateException("无法替换旧的更新包")
            }
            moveOrCopy(source, destination)
            directory.listFiles()?.filter { it != destination }?.forEach { it.delete() }
            destination
        } catch (failure: Throwable) {
            source.delete()
            throw failure
        }
    }

    suspend fun savePublicDownload(
        displayName: String,
        mimeType: String,
        writer: suspend (OutputStream) -> Unit
    ): DownloadedFile = withContext(Dispatchers.IO) {
        val safeName = safeDownloadName(displayName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveWithMediaStore(safeName, mimeType, writer)
        } else {
            saveToLegacyDirectory(safeName, mimeType, writer)
        }
    }

    suspend fun savePdfPreview(
        cacheKey: String,
        maxCacheBytes: Long = DEFAULT_PDF_CACHE_BYTES,
        writer: suspend (OutputStream) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, "pdf-preview").apply { mkdirs() }
        val fileName = pdfCacheName(cacheKey)
        val destination = File(directory, fileName)
        val temporary = File(directory, "$fileName.part")
        if (destination.isFile) {
            val cached = runCatching { validatePdf(destination) }.isSuccess
            if (cached) {
                destination.setLastModified(System.currentTimeMillis())
                return@withContext destination
            }
            destination.delete()
        }
        temporary.delete()
        try {
            FileOutputStream(temporary).use { writer(it) }
            validatePdf(temporary)
            if (destination.exists() && !destination.delete()) {
                throw IllegalStateException("无法替换 PDF 预览缓存")
            }
            if (!temporary.renameTo(destination)) {
                throw IllegalStateException("无法建立 PDF 预览缓存")
            }
            trimPdfCache(directory, destination, maxCacheBytes)
            destination
        } catch (failure: Throwable) {
            temporary.delete()
            throw failure
        }
    }

    suspend fun findPdfPreview(cacheKey: String): File? = withContext(Dispatchers.IO) {
        val fileName = pdfCacheName(cacheKey)
        val candidate = File(pdfCacheDirectory(), fileName)
        if (!candidate.isFile) return@withContext null
        runCatching { validatePdf(candidate) }.getOrElse {
            candidate.delete()
            return@withContext null
        }
        candidate.setLastModified(System.currentTimeMillis())
        candidate
    }

    suspend fun materializePdfForViewer(
        file: DownloadedFile,
        maxCacheBytes: Long = DEFAULT_PDF_CACHE_BYTES
    ): File = savePdfPreview(
        cacheKey = "download-${file.contentUri.hashCode().toUInt().toString(16)}-${file.size}.pdf",
        maxCacheBytes = maxCacheBytes
    ) { output ->
        val input = context.contentResolver.openInputStream(Uri.parse(file.contentUri))
            ?: throw IllegalStateException("无法读取已下载的 PDF")
        input.use { it.copyTo(output, 512 * 1024) }
    }

    fun cachedPdfAsDownloadedFile(localPath: String, displayName: String): DownloadedFile {
        val file = File(localPath).canonicalFile
        val cacheRoot = pdfCacheDirectory().canonicalFile
        require(file.isFile && file.length() > 0 && file.toPath().startsWith(cacheRoot.toPath())) {
            "找不到可分享的 PDF 缓存"
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return DownloadedFile(
            name = safeDownloadName(displayName).let { if (it.endsWith(".pdf", true)) it else "$it.pdf" },
            contentUri = uri.toString(),
            displayPath = file.absolutePath,
            mimeType = "application/pdf",
            size = file.length()
        )
    }

    fun downloadedUpdateAsFile(localPath: String, displayName: String): DownloadedFile {
        val file = File(localPath).canonicalFile
        val updateRoot = updateDirectory().canonicalFile
        require(file.isFile && file.length() > 0 && file.toPath().startsWith(updateRoot.toPath())) {
            "找不到可分享的 Android 安装包"
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return DownloadedFile(
            name = safeName(displayName),
            contentUri = uri.toString(),
            displayPath = file.absolutePath,
            mimeType = "application/vnd.android.package-archive",
            size = file.length()
        )
    }

    suspend fun isDownloadedFileAvailable(file: DownloadedFile): Boolean = withContext(Dispatchers.IO) {
        val uri = runCatching { Uri.parse(file.contentUri) }.getOrNull() ?: return@withContext false
        if (uri.scheme != "content") return@withContext false
        runCatching {
            context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { descriptor ->
                descriptor.length != 0L
            } ?: false
        }.getOrDefault(false)
    }

    fun deleteCachedPdf(localPath: String?): Boolean {
        val value = localPath ?: return false
        val file = runCatching { File(value).canonicalFile }.getOrNull() ?: return false
        val cacheRoot = pdfCacheDirectory().canonicalFile
        if (!file.toPath().startsWith(cacheRoot.toPath())) return false
        return !file.exists() || file.delete()
    }

    suspend fun pdfCacheBytes(): Long = withContext(Dispatchers.IO) {
        pdfCacheDirectory().listFiles()
            ?.filter { it.isFile && !it.name.endsWith(".part") }
            ?.sumOf(File::length)
            ?: 0L
    }

    suspend fun clearPdfCache(): Long = withContext(Dispatchers.IO) {
        val files = pdfCacheDirectory().listFiles().orEmpty()
        var removed = 0L
        files.forEach { file ->
            val size = file.length()
            if (file.isFile && file.delete()) removed += size
        }
        removed
    }

    suspend fun readDownloadedText(file: DownloadedFile, maxBytes: Int): String = withContext(Dispatchers.IO) {
        val input = context.contentResolver.openInputStream(Uri.parse(file.contentUri))
            ?: throw IllegalStateException("无法打开已下载的文件")
        val bytes = input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                if (output.size() + read > maxBytes) {
                    throw IllegalStateException("文件过大，无法在代码查看器中打开")
                }
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        }
        if (bytes.any { it == 0.toByte() }) {
            throw IllegalStateException("该文件不是可阅读的文本文件")
        }
        bytes.toString(Charsets.UTF_8)
    }

    suspend fun saveUpdate(
        asset: AndroidReleaseAsset,
        writer: suspend (OutputStream) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val directory = updateDirectory().apply { mkdirs() }
        val destination = File(directory, safeName(asset.name))
        val temporary = File(directory, "${destination.name}.part")
        temporary.delete()
        try {
            FileOutputStream(temporary).use { writer(it) }
            if (asset.size > 0 && temporary.length() != asset.size) {
                throw IllegalStateException("更新包大小校验失败，请重新下载")
            }
            verifyDigest(temporary, asset.sha256)
            if (destination.exists() && !destination.delete()) {
                throw IllegalStateException("无法替换旧的更新包")
            }
            if (!temporary.renameTo(destination)) {
                throw IllegalStateException("无法保存下载完成的更新包")
            }
            directory.listFiles()?.filter { it != destination }?.forEach { it.delete() }
            destination
        } catch (failure: Throwable) {
            temporary.delete()
            throw failure
        }
    }

    suspend fun findDownloadedUpdate(asset: AndroidReleaseAsset): File? = withContext(Dispatchers.IO) {
        val file = File(updateDirectory(), safeName(asset.name))
        if (!file.isFile || (asset.size > 0 && file.length() != asset.size)) return@withContext null
        runCatching { verifyDigest(file, asset.sha256) }.getOrElse {
            file.delete()
            return@withContext null
        }
        file
    }

    private fun updateDirectory(): File {
        val root = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
        return File(root, "updates")
    }

    private fun pdfCacheDirectory(): File = File(context.cacheDir, "pdf-preview").apply { mkdirs() }

    private fun pdfCacheName(cacheKey: String): String = cacheKey
        .replace(Regex("[^A-Za-z0-9._-]"), "_")
        .take(120)
        .let { if (it.endsWith(".pdf", ignoreCase = true)) it else "$it.pdf" }

    private fun moveOrCopy(source: File, destination: File) {
        if (source.renameTo(destination)) return
        source.inputStream().use { input ->
            FileOutputStream(destination).use { output ->
                input.copyTo(output, COPY_BUFFER_BYTES)
                output.fd.sync()
            }
        }
        source.delete()
    }

    private fun trimPdfCache(directory: File, keep: File, maxCacheBytes: Long) {
        val limit = maxCacheBytes.coerceAtLeast(64L * 1024 * 1024)
        val files = directory.listFiles()
            ?.filter { it.isFile && !it.name.endsWith(".part") }
            ?.sortedBy { it.lastModified() }
            .orEmpty()
        var total = files.sumOf(File::length)
        for (file in files) {
            if (total <= limit) break
            if (file == keep) continue
            val size = file.length()
            if (file.delete()) total -= size
        }
    }

    private suspend fun saveWithMediaStore(
        displayName: String,
        mimeType: String,
        writer: suspend (OutputStream) -> Unit
    ): DownloadedFile {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, displayName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$DOWNLOAD_FOLDER")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("无法创建下载文件")
        try {
            val output = resolver.openOutputStream(uri, "w")
                ?: throw IllegalStateException("无法写入下载文件")
            output.use { writer(it) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            val actualName = queryColumn(uri, OpenableColumns.DISPLAY_NAME) ?: displayName
            val size = queryColumn(uri, OpenableColumns.SIZE)?.toLongOrNull() ?: 0L
            return DownloadedFile(
                name = actualName,
                contentUri = uri.toString(),
                displayPath = "内部存储/Download/$DOWNLOAD_FOLDER/$actualName",
                mimeType = mimeType,
                size = size
            )
        } catch (failure: Throwable) {
            runCatching { resolver.delete(uri, null, null) }
            throw failure
        }
    }

    private suspend fun saveToLegacyDirectory(
        displayName: String,
        mimeType: String,
        writer: suspend (OutputStream) -> Unit
    ): DownloadedFile {
        val root = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
        val directory = File(root, DOWNLOAD_FOLDER).apply { mkdirs() }
        val destination = uniqueFile(directory, displayName)
        val temporary = File(directory, "${destination.name}.part")
        try {
            FileOutputStream(temporary).use { writer(it) }
            if (!temporary.renameTo(destination)) {
                throw IllegalStateException("无法保存下载完成的文件")
            }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", destination)
            return DownloadedFile(
                name = destination.name,
                contentUri = uri.toString(),
                displayPath = destination.absolutePath,
                mimeType = mimeType,
                size = destination.length()
            )
        } catch (failure: Throwable) {
            temporary.delete()
            throw failure
        }
    }

    private fun queryColumn(uri: Uri, column: String): String? {
        return context.contentResolver.query(uri, arrayOf(column), null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val index = cursor.getColumnIndex(column)
            if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }
    }

    private fun uniqueFile(directory: File, requestedName: String): File {
        val direct = File(directory, requestedName)
        if (!direct.exists()) return direct
        val extension = requestedName.substringAfterLast('.', "").takeIf { requestedName.contains('.') }
        val stem = if (extension == null) requestedName else requestedName.dropLast(extension.length + 1)
        var index = 1
        while (true) {
            val suffix = if (extension == null) " ($index)" else " ($index).$extension"
            val candidate = File(directory, "$stem$suffix")
            if (!candidate.exists()) return candidate
            index += 1
        }
    }

    private fun safeDownloadName(name: String): String {
        val cleaned = name
            .substringAfterLast('/')
            .replace(Regex("""[\\/:*?"<>|\p{Cntrl}]"""), "_")
            .trim()
            .take(160)
        return cleaned.ifBlank { "download" }
    }

    private fun safeName(name: String): String {
        val normalized = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
        return normalized.takeIf { it.endsWith(".apk", ignoreCase = true) } ?: "latex-viewer-update.apk"
    }

    private fun verifyDigest(file: File, expected: String?) {
        val normalized = expected
            ?.removePrefix("sha256:")
            ?.trim()
            ?.lowercase()
            ?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
            ?: return
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != normalized) throw IllegalStateException("更新包 SHA-256 校验失败，请重新下载")
    }

    private fun validatePdf(file: File) {
        val probe = ByteArray(1024)
        val read = file.inputStream().use { it.read(probe) }.coerceAtLeast(0)
        val header = String(probe, 0, read, Charsets.US_ASCII)
        if ("%PDF-" in header) return
        if (header.startsWith("version https://git-lfs.github.com/spec/v1")) {
            throw IllegalStateException("GitHub 只返回了 Git LFS 指针，未取得 PDF 正文，请刷新后重试")
        }
        throw IllegalStateException("下载内容不是有效的 PDF 文件")
    }

    private companion object {
        const val DOWNLOAD_FOLDER = "LaTeX项目"
        const val DEFAULT_PDF_CACHE_BYTES = 512L * 1024 * 1024
        const val COPY_BUFFER_BYTES = 1024 * 1024
    }
}
