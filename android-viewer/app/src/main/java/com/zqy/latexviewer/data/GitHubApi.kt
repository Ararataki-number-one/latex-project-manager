package com.zqy.latexviewer.data

import android.net.Uri
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
import java.io.InputStream
import java.io.OutputStream
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
        output: OutputStream,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        require(item.kind == GitHubContentKind.FILE) { "只能下载文件" }
        val apiUrl = "$API_ROOT/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(item.path)}?ref=${encode(repository.defaultBranch)}"
        val directUrl = preferredDownloadUrl(item.downloadUrl)
        streamRequest(
            directUrl ?: apiUrl,
            token,
            if (directUrl == null) RAW_ACCEPT else BINARY_ACCEPT,
            output,
            onProgress
        )
    }

    suspend fun downloadRepositoryArchive(
        repository: GitHubRepository,
        token: String?,
        output: OutputStream,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        val url = "$API_ROOT/repos/${encode(repository.owner)}/${encode(repository.name)}/zipball/${encode(repository.defaultBranch)}"
        streamRequest(url, token, ARCHIVE_ACCEPT, output, onProgress)
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
        output: OutputStream,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        streamRequest(asset.apiUrl, null, BINARY_ACCEPT, output, onProgress)
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

    private fun streamRequest(
        url: String,
        token: String?,
        accept: String,
        output: OutputStream,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            instanceFollowRedirects = true
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = DOWNLOAD_READ_TIMEOUT_MS
            setRequestProperty("Accept", accept)
            setRequestProperty("X-GitHub-Api-Version", API_VERSION)
            setRequestProperty("User-Agent", "LaTeX-Project-Viewer-Android")
            setRequestProperty("Cache-Control", "no-cache")
            setRequestProperty("Pragma", "no-cache")
            setRequestProperty("Connection", "keep-alive")
            token?.trim()?.takeIf { it.isNotEmpty() }?.let {
                setRequestProperty("Authorization", "Bearer $it")
            }
        }
        try {
            val status = connection.responseCode
            if (status !in 200..299) {
                val body = connection.errorStream
                    ?.use { readLimited(it, MAX_ERROR_BYTES) }
                    ?.toString(Charsets.UTF_8)
                    .orEmpty()
                throw GitHubApiException(errorMessage(status, body))
            }
            val total = connection.contentLengthLong.coerceAtLeast(-1L)
            if (total > MAX_DOWNLOAD_BYTES) throw GitHubApiException("下载内容超过 4 GB，无法保存")
            connection.inputStream.use { input ->
                // Larger sequential reads substantially reduce per-chunk coroutine/UI overhead
                // for book-sized PDF and ZIP downloads while keeping memory use predictable.
                val buffer = ByteArray(1024 * 1024)
                var downloaded = 0L
                onProgress(0, total)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    downloaded += read
                    if (downloaded > MAX_DOWNLOAD_BYTES) {
                        throw GitHubApiException("下载内容超过 4 GB，无法保存")
                    }
                    output.write(buffer, 0, read)
                    onProgress(downloaded, total)
                }
                output.flush()
            }
        } finally {
            connection.disconnect()
        }
    }

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

    private fun encode(value: String): String = Uri.encode(value)

    private fun encodePath(path: String): String = path
        .split('/')
        .filter { it.isNotEmpty() }
        .joinToString("/") { encode(it) }

    private companion object {
        const val API_ROOT = "https://api.github.com"
        const val API_VERSION = "2026-03-10"
        const val JSON_ACCEPT = "application/vnd.github+json"
        const val RAW_ACCEPT = "application/vnd.github.raw+json"
        const val ARCHIVE_ACCEPT = "application/vnd.github+json"
        const val BINARY_ACCEPT = "application/octet-stream"
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 30_000
        const val DOWNLOAD_READ_TIMEOUT_MS = 120_000
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
