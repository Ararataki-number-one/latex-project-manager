package com.zqy.latexviewer.data

import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class GitHubApi {
    suspend fun listRepositories(token: String): List<GitHubRepository> = withContext(Dispatchers.IO) {
        require(token.isNotBlank()) { "查看私有仓库需要只读令牌" }
        val repositories = mutableListOf<GitHubRepository>()
        for (page in 1..MAX_REPOSITORY_PAGES) {
            val url = "$API_ROOT/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100&page=$page"
            val array = JSONArray(request(url, token, JSON_ACCEPT, MAX_JSON_BYTES))
            for (index in 0 until array.length()) {
                repositories += parseRepository(array.getJSONObject(index))
            }
            if (array.length() < 100) break
        }
        repositories.distinctBy { it.fullName }
    }

    suspend fun getRepository(reference: String, token: String?): GitHubRepository = withContext(Dispatchers.IO) {
        val (owner, name) = parseReference(reference)
        val url = "$API_ROOT/repos/${encode(owner)}/${encode(name)}"
        parseRepository(JSONObject(request(url, token, JSON_ACCEPT, MAX_JSON_BYTES)))
    }

    suspend fun listContents(
        repository: GitHubRepository,
        path: String,
        token: String?
    ): List<GitHubContent> = withContext(Dispatchers.IO) {
        val encodedPath = encodePath(path)
        val suffix = if (encodedPath.isEmpty()) "" else "/$encodedPath"
        val url = "$API_ROOT/repos/${encode(repository.owner)}/${encode(repository.name)}/contents$suffix?ref=${encode(repository.defaultBranch)}"
        val payload = request(url, token, JSON_ACCEPT, MAX_JSON_BYTES)
        val array = runCatching { JSONArray(payload) }.getOrElse {
            val single = JSONObject(payload)
            JSONArray().put(single)
        }
        buildList {
            for (index in 0 until array.length()) {
                add(parseContent(array.getJSONObject(index)))
            }
        }.sortedWith(
            compareBy<GitHubContent> { it.kind != GitHubContentKind.DIRECTORY }
                .thenBy(String.CASE_INSENSITIVE_ORDER) { it.name }
        )
    }

    suspend fun getContent(
        repository: GitHubRepository,
        path: String,
        token: String?
    ): GitHubContent = withContext(Dispatchers.IO) {
        val normalizedPath = path.trim('/').takeIf { it.isNotEmpty() }
            ?: throw GitHubApiException("文件路径不能为空")
        val url = "$API_ROOT/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(normalizedPath)}?ref=${encode(repository.defaultBranch)}"
        parseContent(JSONObject(request(url, token, JSON_ACCEPT, MAX_JSON_BYTES)))
    }

    suspend fun mobileProjectIndex(
        repository: GitHubRepository,
        token: String?
    ): MobileProjectIndex? = withContext(Dispatchers.IO) {
        val metadata = runCatching { getContent(repository, MOBILE_INDEX_PATH, token) }.getOrNull()
            ?: return@withContext null
        if (metadata.kind != GitHubContentKind.FILE || metadata.size > MAX_MOBILE_INDEX_BYTES) {
            return@withContext null
        }
        val raw = runCatching { readTextFile(repository, metadata, token) }.getOrNull()
            ?: return@withContext null
        parseMobileProjectIndex(raw)
    }

    suspend fun readTextFile(
        repository: GitHubRepository,
        item: GitHubContent,
        token: String?
    ): String = withContext(Dispatchers.IO) {
        require(item.kind == GitHubContentKind.FILE) { "只能预览文件" }
        require(item.size <= MAX_INLINE_FILE_BYTES) { "文件超过 1.5 MB，请在 GitHub 中查看" }
        require(isInlineText(item.name)) { "该文件不是可直接阅读的文本格式" }
        val url = "$API_ROOT/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(item.path)}?ref=${encode(repository.defaultBranch)}"
        val bytes = requestBytes(url, token, RAW_ACCEPT, MAX_INLINE_FILE_BYTES.toInt() + 1)
        if (bytes.size > MAX_INLINE_FILE_BYTES || bytes.any { it == 0.toByte() }) {
            throw GitHubApiException("该文件不是可直接阅读的文本，或文件过大")
        }
        bytes.toString(Charsets.UTF_8)
    }

    suspend fun downloadFile(
        repository: GitHubRepository,
        item: GitHubContent,
        token: String?,
        destination: File,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        require(item.kind == GitHubContentKind.FILE) { "只能下载文件" }
        downloadWithFallback(
            candidates = downloadCandidates(repository, item),
            token = token,
            destination = destination,
            expectPdf = item.name.endsWith(".pdf", ignoreCase = true),
            onProgress = onProgress
        )
    }

    suspend fun downloadRepositoryArchive(
        repository: GitHubRepository,
        token: String?,
        destination: File,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        val apiUrl = "$API_ROOT/repos/${encode(repository.owner)}/${encode(repository.name)}/zipball/${encode(repository.defaultBranch)}"
        val browserUrl = "https://github.com/${encode(repository.owner)}/${encode(repository.name)}/archive/refs/heads/${encode(repository.defaultBranch)}.zip"
        downloadWithFallback(
            candidates = listOf(
                DownloadCandidate(apiUrl, ARCHIVE_ACCEPT),
                DownloadCandidate(browserUrl, BINARY_ACCEPT)
            ),
            token = token,
            destination = destination,
            expectPdf = false,
            onProgress = onProgress
        )
    }

    suspend fun latestAndroidRelease(): AndroidReleaseAsset = withContext(Dispatchers.IO) {
        val payload = request(
            "$API_ROOT/repos/$UPDATE_REPOSITORY/releases/latest",
            null,
            JSON_ACCEPT,
            MAX_JSON_BYTES
        )
        val release = JSONObject(payload)
        val assets = release.optJSONArray("assets") ?: JSONArray()
        val asset = (0 until assets.length())
            .map { assets.getJSONObject(it) }
            .firstOrNull {
                it.optString("name").endsWith(".apk", ignoreCase = true) &&
                    it.optString("name").contains("android", ignoreCase = true)
            }
            ?: throw GitHubApiException("最新 Release 中没有 Android APK")
        val name = asset.getString("name")
        val releaseTag = release.optString("tag_name")
        val version = ANDROID_VERSION.find(name)?.groupValues?.get(1)
            ?: releaseTag.removePrefix("v")
        AndroidReleaseAsset(
            version = version,
            releaseTag = releaseTag,
            releaseUrl = release.optString("html_url", "https://github.com/$UPDATE_REPOSITORY/releases/latest"),
            name = name,
            apiUrl = asset.getString("url"),
            downloadUrl = asset.getString("browser_download_url"),
            size = asset.optLong("size"),
            sha256 = asset.optString("digest").takeIf { it.isNotBlank() && it != "null" }
        )
    }

    suspend fun downloadAndroidUpdate(
        asset: AndroidReleaseAsset,
        destination: File,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        downloadWithFallback(
            candidates = listOf(
                DownloadCandidate(asset.downloadUrl, BINARY_ACCEPT),
                DownloadCandidate(asset.apiUrl, BINARY_ACCEPT)
            ).filter { it.url.startsWith("https://") },
            token = null,
            destination = destination,
            expectPdf = false,
            onProgress = onProgress
        )
    }

    fun isInlineText(fileName: String): Boolean {
        val lower = fileName.lowercase()
        if (lower in PLAIN_TEXT_NAMES) return true
        val extension = lower.substringAfterLast('.', "")
        return extension in TEXT_EXTENSIONS
    }

    internal fun parseMobileProjectIndex(raw: String): MobileProjectIndex? = runCatching {
        val value = JSONObject(raw)
        if (value.optInt("schemaVersion") != 1) return@runCatching null
        val projectId = value.getString("projectId").trim()
        val displayName = value.getString("name").trim()
        val updatedAt = value.getString("updatedAt").trim()
        val defaultOutputId = value.getString("defaultOutputId").trim()
        if (projectId.isEmpty() || displayName.isEmpty() || updatedAt.isEmpty() || defaultOutputId.isEmpty()) {
            return@runCatching null
        }
        val rawOutputs = value.getJSONArray("outputs")
        val outputs = buildList {
            for (index in 0 until rawOutputs.length()) {
                val output = rawOutputs.getJSONObject(index)
                val parsed = MobilePdfOutput(
                    id = output.getString("id").trim(),
                    targetId = output.getString("targetId").trim(),
                    name = output.getString("name").trim(),
                    entry = output.getString("entry").trim(),
                    profileId = output.optString("profileId").trim().takeIf { it.isNotEmpty() && it != "null" },
                    pdfPath = output.getString("pdfPath").trim()
                )
                if (parsed.id.isEmpty() || parsed.targetId.isEmpty() || parsed.name.isEmpty()
                    || parsed.entry.isEmpty() || !isSafePdfPath(parsed.pdfPath)
                ) return@runCatching null
                add(parsed)
            }
        }
        if (outputs.isEmpty() || outputs.map(MobilePdfOutput::id).distinct().size != outputs.size
            || outputs.none { it.id == defaultOutputId }
        ) return@runCatching null
        MobileProjectIndex(1, projectId, displayName, updatedAt, defaultOutputId, outputs)
    }.getOrNull()

    internal fun isSafePdfPath(path: String): Boolean {
        if (path.isBlank() || path.startsWith('/') || path.startsWith('\\') || WINDOWS_DRIVE.matches(path)) return false
        val parts = path.replace('\\', '/').split('/')
        return parts.none { it.isBlank() || it == "." || it == ".." } && path.endsWith(".pdf", ignoreCase = true)
    }

    internal fun preferredDownloadUrl(value: String?): String? {
        val parsed = runCatching { URL(value ?: return null) }.getOrNull() ?: return null
        if (parsed.protocol != "https") return null
        return when (parsed.host.lowercase()) {
            "raw.githubusercontent.com" -> buildString {
                append("https://media.githubusercontent.com/media")
                append(parsed.path)
                parsed.query?.takeIf { it.isNotBlank() }?.let { append('?').append(it) }
            }
            in GITHUB_DOWNLOAD_HOSTS -> value
            else -> null
        }
    }

    internal fun downloadUrlCandidates(repository: GitHubRepository, item: GitHubContent): List<String> =
        downloadCandidates(repository, item).map(DownloadCandidate::url)

    private fun downloadCandidates(
        repository: GitHubRepository,
        item: GitHubContent
    ): List<DownloadCandidate> {
        val apiUrl = "$API_ROOT/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(item.path)}?ref=${encode(repository.defaultBranch)}"
        val direct = item.downloadUrl?.let { raw ->
            runCatching { URL(raw) }.getOrNull()
                ?.takeIf { it.protocol == "https" && it.host.lowercase() in GITHUB_DOWNLOAD_HOSTS }
                ?.let { DownloadCandidate(raw, BINARY_ACCEPT) }
        }
        val media = preferredDownloadUrl(item.downloadUrl)?.let { DownloadCandidate(it, BINARY_ACCEPT) }
        val api = DownloadCandidate(apiUrl, RAW_ACCEPT)
        val ordered = if (repository.isPrivate) listOf(api, media, direct) else listOf(media, direct, api)
        return ordered.filterNotNull().distinctBy(DownloadCandidate::url)
    }

    private fun parseRepository(value: JSONObject): GitHubRepository {
        val owner = value.getJSONObject("owner").getString("login")
        return GitHubRepository(
            name = value.getString("name"),
            fullName = value.getString("full_name"),
            owner = owner,
            description = value.optString("description").takeIf { it.isNotBlank() && it != "null" },
            isPrivate = value.optBoolean("private"),
            defaultBranch = value.optString("default_branch", "main"),
            updatedAt = value.optString("updated_at"),
            htmlUrl = value.optString("html_url", "https://github.com/${value.getString("full_name")}"),
            sizeKb = value.optLong("size")
        )
    }

    private fun parseContent(value: JSONObject): GitHubContent {
        val kind = when {
            !value.isNull("submodule_git_url") -> GitHubContentKind.SUBMODULE
            value.optString("type") == "dir" -> GitHubContentKind.DIRECTORY
            value.optString("type") == "file" -> GitHubContentKind.FILE
            value.optString("type") == "symlink" -> GitHubContentKind.SYMLINK
            else -> GitHubContentKind.UNKNOWN
        }
        return GitHubContent(
            name = value.getString("name"),
            path = value.getString("path"),
            kind = kind,
            size = value.optLong("size"),
            sha = value.optString("sha"),
            htmlUrl = value.optString("html_url").takeIf { it.isNotBlank() && it != "null" },
            downloadUrl = value.optString("download_url").takeIf { it.isNotBlank() && it != "null" }
        )
    }

    private fun request(url: String, token: String?, accept: String, maxBytes: Int): String {
        return requestBytes(url, token, accept, maxBytes).toString(Charsets.UTF_8)
    }

    private fun requestBytes(url: String, token: String?, accept: String, maxBytes: Int): ByteArray {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Accept", accept)
            setRequestProperty("X-GitHub-Api-Version", API_VERSION)
            setRequestProperty("User-Agent", "LaTeX-Project-Viewer-Android")
            setRequestProperty("Cache-Control", "no-cache")
            setRequestProperty("Pragma", "no-cache")
            token?.trim()?.takeIf { it.isNotEmpty() }?.let {
                setRequestProperty("Authorization", "Bearer $it")
            }
        }
        return try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { readLimited(it, maxBytes) } ?: ByteArray(0)
            if (status !in 200..299) {
                throw GitHubApiException(errorMessage(status, bytes.toString(Charsets.UTF_8)))
            }
            bytes
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadWithFallback(
        candidates: List<DownloadCandidate>,
        token: String?,
        destination: File,
        expectPdf: Boolean,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) {
        require(candidates.isNotEmpty()) { "没有可用的安全下载地址" }
        destination.parentFile?.mkdirs()
        if (expectPdf && destination.isFile) {
            runCatching { validatePdfPrefix(destination, complete = false) }.onFailure {
                destination.delete()
            }
        }

        var lastFailure: Throwable? = null
        candidates.forEachIndexed { index, candidate ->
            try {
                streamRequestToFile(
                    candidate = candidate,
                    token = token,
                    destination = destination,
                    expectPdf = expectPdf,
                    failFastOnSlowStart = index < candidates.lastIndex,
                    onProgress = onProgress
                )
                if (expectPdf) validatePdfPrefix(destination, complete = true)
                return
            } catch (failure: Throwable) {
                if (Thread.currentThread().isInterrupted) throw failure
                lastFailure = failure
                if (failure is InvalidDownloadContentException) destination.delete()
            }
        }
        throw lastFailure ?: GitHubApiException("下载失败，请稍后重试")
    }

    private fun streamRequestToFile(
        candidate: DownloadCandidate,
        token: String?,
        destination: File,
        expectPdf: Boolean,
        failFastOnSlowStart: Boolean,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) {
        var mayRestart = true
        while (true) {
            val existing = destination.takeIf(File::isFile)?.length()?.coerceAtLeast(0L) ?: 0L
            val connection = (URL(candidate.url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                instanceFollowRedirects = true
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = DOWNLOAD_READ_TIMEOUT_MS
                setRequestProperty("Accept", candidate.accept)
                setRequestProperty("Accept-Encoding", "identity")
                setRequestProperty("X-GitHub-Api-Version", API_VERSION)
                setRequestProperty("User-Agent", "LaTeX-Project-Viewer-Android")
                setRequestProperty("Cache-Control", "no-cache")
                setRequestProperty("Pragma", "no-cache")
                setRequestProperty("Connection", "keep-alive")
                if (existing > 0) setRequestProperty("Range", "bytes=$existing-")
                token?.trim()?.takeIf { it.isNotEmpty() }?.let {
                    setRequestProperty("Authorization", "Bearer $it")
                }
            }
            try {
                val status = connection.responseCode
                if (status == HTTP_RANGE_NOT_SATISFIABLE && existing > 0) {
                    val remoteTotal = parseUnsatisfiedTotal(connection.getHeaderField("Content-Range"))
                    if (remoteTotal == existing) {
                        onProgress(existing, existing)
                        return
                    }
                    if (mayRestart) {
                        mayRestart = false
                        destination.delete()
                        continue
                    }
                }
                if (status !in 200..299) {
                    val body = connection.errorStream
                        ?.use { readLimited(it, MAX_ERROR_BYTES) }
                        ?.toString(Charsets.UTF_8)
                        .orEmpty()
                    throw GitHubApiException(errorMessage(status, body))
                }

                val appending = status == HttpURLConnection.HTTP_PARTIAL && existing > 0
                val downloadedBeforeRequest = if (appending) existing else 0L
                if (!appending && existing > 0) destination.delete()
                val responseBytes = connection.contentLengthLong.coerceAtLeast(-1L)
                val total = parseContentRangeTotal(connection.getHeaderField("Content-Range"))
                    ?: responseBytes.takeIf { it >= 0 }?.let { it + downloadedBeforeRequest }
                    ?: -1L
                if (total > MAX_DOWNLOAD_BYTES) throw GitHubApiException("下载内容超过 4 GB，无法保存")

                val startedAt = System.nanoTime()
                var downloaded = downloadedBeforeRequest
                var pdfPrefixValidated = !expectPdf || downloadedBeforeRequest > 0L
                onProgress(downloaded, total)
                FileOutputStream(destination, appending).use { output ->
                    connection.inputStream.use { input ->
                        val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            downloaded += read
                            if (downloaded > MAX_DOWNLOAD_BYTES) {
                                throw GitHubApiException("下载内容超过 4 GB，无法保存")
                            }
                            if (!pdfPrefixValidated && downloaded >= PDF_PREFIX_PROBE_BYTES) {
                                output.flush()
                                validatePdfPrefix(destination, complete = false)
                                pdfPrefixValidated = true
                            }
                            onProgress(downloaded, total)
                            val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L
                            val receivedThisRequest = downloaded - downloadedBeforeRequest
                            if (failFastOnSlowStart && elapsedMs >= SLOW_SOURCE_WINDOW_MS &&
                                receivedThisRequest < SLOW_SOURCE_MIN_BYTES
                            ) {
                                output.flush()
                                if (expectPdf) validatePdfPrefix(destination, complete = false)
                                throw SlowDownloadSourceException()
                            }
                        }
                    }
                    output.fd.sync()
                }
                if (downloaded <= 0L) throw GitHubApiException("GitHub 返回了空文件")
                return
            } finally {
                connection.disconnect()
            }
        }
    }

    private fun validatePdfPrefix(file: File, complete: Boolean) {
        if (!file.isFile || file.length() <= 0) {
            if (complete) throw InvalidDownloadContentException("下载到的 PDF 是空文件")
            return
        }
        val probe = ByteArray(PDF_PREFIX_PROBE_BYTES)
        val read = file.inputStream().use { it.read(probe) }.coerceAtLeast(0)
        val header = String(probe, 0, read, Charsets.US_ASCII)
        if ("%PDF-" in header) return
        if (header.startsWith("version https://git-lfs.github.com/spec/v1")) {
            throw InvalidDownloadContentException("GitHub 返回了 Git LFS 指针，正在尝试备用下载地址")
        }
        if (complete || read >= PDF_PREFIX_PROBE_BYTES || header.trimStart().startsWith("<")) {
            throw InvalidDownloadContentException("GitHub 返回的内容不是有效 PDF")
        }
    }

    private fun parseContentRangeTotal(value: String?): Long? = value
        ?.substringAfter('/', "")
        ?.takeIf { it != "*" }
        ?.toLongOrNull()

    private fun parseUnsatisfiedTotal(value: String?): Long? = parseContentRangeTotal(value)

    private fun readLimited(input: InputStream, maxBytes: Int): ByteArray {
        val output = ByteArrayOutputStream(minOf(maxBytes, 64 * 1024))
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > maxBytes) throw GitHubApiException("GitHub 返回的数据过大，无法在手机中直接显示")
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun errorMessage(status: Int, body: String): String {
        val detail = runCatching { JSONObject(body).optString("message") }.getOrNull()
        return when (status) {
            401 -> "GitHub 令牌无效或已经过期"
            403 -> if (detail?.contains("rate limit", ignoreCase = true) == true) {
                "GitHub 请求次数已达上限，请稍后再试"
            } else {
                "当前令牌没有读取这个仓库的权限"
            }
            404 -> "没有找到仓库或文件，私有仓库请检查令牌权限"
            409 -> "这个仓库目前是空的"
            else -> detail?.takeIf { it.isNotBlank() } ?: "GitHub 请求失败（$status）"
        }
    }

    private fun parseReference(reference: String): Pair<String, String> {
        val parts = reference.trim().removePrefix("https://github.com/").trim('/').split('/')
        require(parts.size == 2 && parts.all { REPOSITORY_PART.matches(it) }) {
            "仓库地址应写成 owner/repository"
        }
        return parts[0] to parts[1].removeSuffix(".git")
    }

    private fun encode(value: String): String = buildString {
        value.toByteArray(Charsets.UTF_8).forEach { byte ->
            val unsigned = byte.toInt() and 0xff
            val unreserved = unsigned in 'a'.code..'z'.code ||
                unsigned in 'A'.code..'Z'.code ||
                unsigned in '0'.code..'9'.code ||
                unsigned == '-'.code || unsigned == '_'.code ||
                unsigned == '.'.code || unsigned == '~'.code
            if (unreserved) {
                append(unsigned.toChar())
            } else {
                append('%')
                append(HEX_DIGITS[unsigned ushr 4])
                append(HEX_DIGITS[unsigned and 0x0f])
            }
        }
    }

    private fun encodePath(path: String): String = path
        .split('/')
        .filter { it.isNotEmpty() }
        .joinToString("/") { encode(it) }

    private companion object {
        const val API_ROOT = "https://api.github.com"
        const val HEX_DIGITS = "0123456789ABCDEF"
        const val API_VERSION = "2026-03-10"
        const val JSON_ACCEPT = "application/vnd.github+json"
        const val RAW_ACCEPT = "application/vnd.github.raw+json"
        const val ARCHIVE_ACCEPT = "application/vnd.github+json"
        const val BINARY_ACCEPT = "application/octet-stream"
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 30_000
        const val DOWNLOAD_READ_TIMEOUT_MS = 35_000
        const val DOWNLOAD_BUFFER_BYTES = 1024 * 1024
        const val PDF_PREFIX_PROBE_BYTES = 1024
        const val SLOW_SOURCE_WINDOW_MS = 15_000L
        const val SLOW_SOURCE_MIN_BYTES = 1536L * 1024
        const val HTTP_RANGE_NOT_SATISFIABLE = 416
        const val MAX_JSON_BYTES = 5 * 1024 * 1024
        const val MAX_ERROR_BYTES = 128 * 1024
        const val MAX_INLINE_FILE_BYTES = 1_500_000
        const val MAX_REPOSITORY_PAGES = 10
        const val MAX_MOBILE_INDEX_BYTES = 256_000L
        const val MAX_DOWNLOAD_BYTES = 4L * 1024 * 1024 * 1024
        const val MOBILE_INDEX_PATH = ".latex-project.json"
        const val UPDATE_REPOSITORY = "Ararataki-number-one/latex-project-manager"
        val ANDROID_VERSION = Regex("(?i)([0-9]+\\.[0-9]+\\.[0-9]+)(?=\\.apk$)")
        val REPOSITORY_PART = Regex("[A-Za-z0-9_.-]+")
        val WINDOWS_DRIVE = Regex("^[A-Za-z]:[/\\\\].*")
        val PLAIN_TEXT_NAMES = setOf("readme", "license", "makefile", "latexmkrc", ".gitignore", ".gitattributes")
        val TEXT_EXTENSIONS = setOf(
            "tex", "bib", "cls", "sty", "bst", "bbx", "cbx", "lbx", "dtx", "ins",
            "md", "mdx", "txt", "rst", "adoc", "json", "jsonc", "yaml", "yml", "toml", "xml",
            "csv", "tsv", "ini", "cfg", "conf", "properties", "gradle", "kts", "kt", "java",
            "c", "h", "cpp", "hpp", "py", "r", "m", "js", "jsx", "ts", "tsx", "css", "scss",
            "html", "htm", "sh", "ps1", "bat", "cmd", "sql", "log"
        )
        val GITHUB_DOWNLOAD_HOSTS = setOf(
            "media.githubusercontent.com",
            "raw.githubusercontent.com"
        )
    }
}

class GitHubApiException(message: String) : Exception(message)

private data class DownloadCandidate(val url: String, val accept: String)

private class InvalidDownloadContentException(message: String) : Exception(message)

private class SlowDownloadSourceException : Exception("当前 GitHub 下载源响应过慢，正在切换备用地址")
