package com.zqy.latexviewer.data

import android.content.Context
import android.net.Uri
import android.os.Environment
import com.zqy.latexviewer.model.AndroidReleaseAsset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.security.MessageDigest

class DownloadStore(private val context: Context) {
    suspend fun saveDocument(
        destination: Uri,
        writer: suspend (OutputStream) -> Unit
    ) = withContext(Dispatchers.IO) {
        try {
            val output = context.contentResolver.openOutputStream(destination, "w")
                ?: throw IllegalStateException("无法打开所选保存位置")
            output.use { writer(it) }
        } catch (failure: Throwable) {
            runCatching { context.contentResolver.delete(destination, null, null) }
            throw failure
        }
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
}
