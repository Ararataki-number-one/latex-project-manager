package com.zqy.latexviewer.data

import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubCommitSnapshot
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.RepositoryRefreshFailureKind
import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.Base64

class GitHubApi(
    private val apiRoot: String = DEFAULT_API_ROOT,
    private val githubRoot: String = DEFAULT_GITHUB_ROOT
) {
    suspend fun listRepositories(token: String): List<GitHubRepository> = withContext(Dispatchers.IO) {
        require(token.isNotBlank()) { "查看私有仓库需要只读令牌" }
        val repositories = mutableListOf<GitHubRepository>()
        for (page in 1..MAX_REPOSITORY_PAGES) {
            val url = "$apiRoot/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100&page=$page"
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
        val url = "$apiRoot/repos/${encode(owner)}/${encode(name)}"
        parseRepository(JSONObject(request(url, token, JSON_ACCEPT, MAX_JSON_BYTES)))
    }

    suspend fun validateToken(token: String): GitHubUser = withContext(Dispatchers.IO) {
        require(token.isNotBlank()) { "GitHub 访问令牌不能为空" }
        val value = JSONObject(request("$apiRoot/user", token, JSON_ACCEPT, MAX_JSON_BYTES))
        GitHubUser(
            login = value.getString("login"),
            avatarUrl = value.optString("avatar_url").takeIf { it.isNotBlank() },
            htmlUrl = value.optString("html_url").takeIf { it.isNotBlank() }
        )
    }

    suspend fun startDeviceFlow(clientId: String): GitHubDeviceAuthorization = withContext(Dispatchers.IO) {
        require(clientId.isNotBlank()) { "此构建尚未配置 GitHub 登录；仍可添加公开项目或使用高级令牌" }
        val response = postForm(
            "$githubRoot/login/device/code",
            mapOf("client_id" to clientId, "scope" to "repo read:user")
        )
        val value = JSONObject(response)
        GitHubDeviceAuthorization(
            deviceCode = value.getString("device_code"),
            userCode = value.getString("user_code"),
            verificationUri = value.getString("verification_uri"),
            expiresInSeconds = value.optLong("expires_in", 900L),
            intervalSeconds = value.optLong("interval", 5L).coerceAtLeast(5L)
        )
    }

    suspend fun pollDeviceFlow(clientId: String, deviceCode: String): GitHubDeviceTokenResult =
        withContext(Dispatchers.IO) {
            require(clientId.isNotBlank() && deviceCode.isNotBlank()) { "GitHub 登录请求无效" }
            val response = postForm(
                "$githubRoot/login/oauth/access_token",
                mapOf(
                    "client_id" to clientId,
                    "device_code" to deviceCode,
                    "grant_type" to "urn:ietf:params:oauth:grant-type:device_code"
                )
            )
            val value = JSONObject(response)
            value.optString("access_token").takeIf { it.isNotBlank() }?.let {
                return@withContext GitHubDeviceTokenResult.Authorized(it)
            }
            when (value.optString("error")) {
                "authorization_pending" -> GitHubDeviceTokenResult.Pending
                "slow_down" -> GitHubDeviceTokenResult.SlowDown
                "expired_token" -> GitHubDeviceTokenResult.Expired
                "access_denied" -> GitHubDeviceTokenResult.Denied
                else -> GitHubDeviceTokenResult.Failed(
                    value.optString("error_description").ifBlank { "GitHub 登录失败" }
                )
            }
        }

    suspend fun resolveCommit(
        repository: GitHubRepository,
        token: String?,
        forceRefresh: Boolean = false
    ): GitHubCommitSnapshot = withContext(Dispatchers.IO) {
        repository.commitSha?.takeIf { !forceRefresh && COMMIT_SHA.matches(it) }?.let {
            return@withContext GitHubCommitSnapshot(repository.fullName, it, null)
        }
        val url = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/commits/${encode(repository.defaultBranch)}"
        val value = JSONObject(request(url, token, JSON_ACCEPT, MAX_JSON_BYTES))
        val commitSha = value.getString("sha")
        val treeSha = value.optJSONObject("commit")?.optJSONObject("tree")?.optString("sha")
        GitHubCommitSnapshot(repository.fullName, commitSha, treeSha)
    }

    suspend fun listContents(
        repository: GitHubRepository,
        path: String,
        token: String?
    ): List<GitHubContent> = withContext(Dispatchers.IO) {
        val commit = resolveCommit(repository, token)
        val encodedPath = encodePath(path)
        val suffix = if (encodedPath.isEmpty()) "" else "/$encodedPath"
        val url = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/contents$suffix?ref=${encode(commit.commitSha)}"
        val payload = request(url, token, JSON_ACCEPT, MAX_JSON_BYTES)
        val array = runCatching { JSONArray(payload) }.getOrElse {
            val single = JSONObject(payload)
            JSONArray().put(single)
        }
        buildList {
            for (index in 0 until array.length()) {
                add(parseContent(array.getJSONObject(index), commit.commitSha))
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
        val commit = resolveCommit(repository, token)
        val normalizedPath = path.trim('/').takeIf { it.isNotEmpty() }
            ?: throw GitHubApiException("文件路径不能为空")
        val url = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(normalizedPath)}?ref=${encode(commit.commitSha)}"
        val parsed = parseContent(JSONObject(request(url, token, JSON_ACCEPT, MAX_JSON_BYTES)), commit.commitSha)
        enrichContentIntegrity(repository, parsed, token)
    }

    private fun getContentAtCommit(
        repository: GitHubRepository,
        path: String,
        commitSha: String,
        token: String?
    ): GitHubContent {
        val normalizedPath = path.trim('/').takeIf(String::isNotEmpty)
            ?: throw GitHubApiException("文件路径不能为空")
        val url = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(normalizedPath)}?ref=${encode(commitSha)}"
        return parseContent(JSONObject(request(url, token, JSON_ACCEPT, MAX_JSON_BYTES)), commitSha)
    }

    private fun enrichContentIntegrity(
        repository: GitHubRepository,
        item: GitHubContent,
        token: String?
    ): GitHubContent {
        if (item.kind != GitHubContentKind.FILE || !GIT_OBJECT_SHA.matches(item.gitObjectSha)) return item
        val url = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/git/blobs/${encode(item.gitObjectSha)}"
        return runCatching {
            val blob = JSONObject(request(url, token, JSON_ACCEPT, MAX_LFS_POINTER_JSON_BYTES))
            if (blob.optLong("size") > MAX_LFS_POINTER_BYTES) return@runCatching item
            val content = blob.optString("content").replace("\n", "")
            if (!blob.optString("encoding").equals("base64", true) || content.isBlank()) return@runCatching item
            val pointer = String(Base64.getDecoder().decode(content), Charsets.UTF_8)
            val oid = LFS_OID.find(pointer)?.groupValues?.getOrNull(1) ?: return@runCatching item
            val lfsSize = LFS_SIZE.find(pointer)?.groupValues?.getOrNull(1)?.toLongOrNull()
            item.copy(
                size = lfsSize ?: item.size,
                lfsOidSha256 = oid.lowercase()
            )
        }.getOrDefault(item)
    }

    suspend fun mobileProjectIndex(
        repository: GitHubRepository,
        token: String?
    ): MobileProjectIndex? = when (val result = mobileProjectIndexResult(repository, token)) {
        is MobileIndexFetchResult.Found -> result.index
        MobileIndexFetchResult.Missing, MobileIndexFetchResult.Malformed -> null
    }

    suspend fun mobileProjectIndexResult(
        repository: GitHubRepository,
        token: String?
    ): MobileIndexFetchResult = withContext(Dispatchers.IO) {
        val commit = resolveCommit(repository, token, forceRefresh = true)
        val metadata = try {
            getContentAtCommit(repository, MOBILE_INDEX_PATH, commit.commitSha, token)
        } catch (failure: GitHubRequestException) {
            if (failure.kind == RepositoryRefreshFailureKind.NOT_FOUND) return@withContext MobileIndexFetchResult.Missing
            throw failure
        }
        if (metadata.kind != GitHubContentKind.FILE || metadata.size > MAX_MOBILE_INDEX_BYTES) {
            return@withContext MobileIndexFetchResult.Malformed
        }
        val raw = readTextFile(repository, metadata, token)
        parseMobileProjectIndex(raw, commit.commitSha)?.let(MobileIndexFetchResult::Found)
            ?: MobileIndexFetchResult.Malformed
    }

    suspend fun readTextFile(
        repository: GitHubRepository,
        item: GitHubContent,
        token: String?
    ): String = withContext(Dispatchers.IO) {
        require(item.kind == GitHubContentKind.FILE) { "只能预览文件" }
        require(item.size <= MAX_INLINE_FILE_BYTES) { "文件超过 1.5 MB，请在 GitHub 中查看" }
        require(isInlineText(item.name)) { "该文件不是可直接阅读的文本格式" }
        val immutableRef = item.commitSha ?: repository.commitSha ?: resolveCommit(repository, token).commitSha
        val url = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(item.path)}?ref=${encode(immutableRef)}"
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
            expectedSize = item.size.takeIf { it > 0 },
            expectedGitBlobSha = item.gitObjectSha.takeIf { GIT_OBJECT_SHA.matches(it) && item.lfsOidSha256 == null },
            expectedLfsSha256 = item.lfsOidSha256,
            onProgress = onProgress
        )
    }

    suspend fun downloadRepositoryArchive(
        repository: GitHubRepository,
        token: String?,
        destination: File,
        onProgress: (downloaded: Long, total: Long) -> Unit
    ) = withContext(Dispatchers.IO) {
        val commit = resolveCommit(repository, token)
        val apiUrl = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/zipball/${encode(commit.commitSha)}"
        val browserUrl = "$githubRoot/${encode(repository.owner)}/${encode(repository.name)}/archive/${encode(commit.commitSha)}.zip"
        downloadWithFallback(
            candidates = listOf(
                DownloadCandidate(apiUrl, ARCHIVE_ACCEPT),
                DownloadCandidate(browserUrl, BINARY_ACCEPT)
            ),
            token = token,
            destination = destination,
            expectPdf = false,
            expectedSize = null,
            expectedGitBlobSha = null,
            expectedLfsSha256 = null,
            onProgress = onProgress
        )
    }

    suspend fun latestAndroidRelease(): AndroidReleaseAsset = withContext(Dispatchers.IO) {
        val payload = request(
            "$apiRoot/repos/$UPDATE_REPOSITORY/releases/latest",
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
        val manifestAsset = (0 until assets.length())
            .map { assets.getJSONObject(it) }
            .firstOrNull { it.optString("name") == ReleaseSecurity.MANIFEST_NAME }
            ?: throw GitHubApiException("此 Release 缺少签名发布清单，已拒绝自动更新")
        val manifestRaw = request(
            manifestAsset.getString("url"),
            null,
            RAW_ACCEPT,
            MAX_RELEASE_MANIFEST_BYTES
        )
        val verified = runCatching { ReleaseSecurity.verifyManifest(manifestRaw, releaseTag) }
            .getOrElse { throw GitHubApiException(it.message ?: "更新清单签名验证失败", it) }
        require(verified.name == name) { "签名发布清单指向了不同的 Android 安装包" }
        val version = ANDROID_VERSION.find(name)?.groupValues?.get(1)
            ?: releaseTag.removePrefix("v")
        AndroidReleaseAsset(
            version = version,
            releaseTag = releaseTag,
            releaseUrl = release.optString("html_url", "https://github.com/$UPDATE_REPOSITORY/releases/latest"),
            name = name,
            apiUrl = asset.getString("url"),
            downloadUrl = asset.getString("browser_download_url"),
            size = verified.size,
            sha256 = verified.sha256,
            manifestVerified = true,
            certificateSha256 = verified.certificateSha256
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
            expectedSize = asset.size.takeIf { it > 0 },
            expectedGitBlobSha = null,
            expectedLfsSha256 = asset.sha256?.removePrefix("sha256:"),
            onProgress = onProgress
        )
    }

    fun isInlineText(fileName: String): Boolean {
        val lower = fileName.lowercase()
        if (lower in PLAIN_TEXT_NAMES) return true
        val extension = lower.substringAfterLast('.', "")
        return extension in TEXT_EXTENSIONS
    }

    internal fun parseMobileProjectIndex(raw: String, commitSha: String? = null): MobileProjectIndex? = runCatching {
        val value = JSONObject(raw)
        val schemaVersion = value.optInt("schemaVersion", 1)
        if (schemaVersion !in 1..2) return@runCatching null
        val projectId = value.optString("projectId", value.optString("id")).trim()
        val displayName = value.optString("name", value.optString("displayName")).trim()
        val updatedAt = value.optString("updatedAt").trim()
        val defaultOutputId = value.optString("defaultOutputId", value.optString("defaultPdfId")).trim()
        if (projectId.isEmpty() || displayName.isEmpty() || defaultOutputId.isEmpty()) {
            return@runCatching null
        }
        val rawOutputs = value.optJSONArray("outputs") ?: value.optJSONArray("pdfOutputs")
            ?: return@runCatching null
        val outputs = buildList {
            for (index in 0 until rawOutputs.length()) {
                val output = rawOutputs.getJSONObject(index)
                val parsed = MobilePdfOutput(
                    id = output.optString("id").trim().ifBlank { "output-$index" },
                    targetId = output.optString("targetId", output.optString("target")).trim().ifBlank { "default" },
                    name = output.optString("name").trim().ifBlank {
                        output.optString("pdfPath", output.optString("path")).substringAfterLast('/')
                    },
                    entry = output.optString("entry").trim(),
                    profileId = output.optString("profileId").trim().takeIf { it.isNotEmpty() && it != "null" },
                    pdfPath = output.optString("pdfPath", output.optString("path")).trim()
                )
                if (parsed.id.isEmpty() || parsed.targetId.isEmpty() || parsed.name.isEmpty()
                    || !isSafePdfPath(parsed.pdfPath)
                ) return@runCatching null
                add(parsed)
            }
        }
        if (outputs.isEmpty() || outputs.map(MobilePdfOutput::id).distinct().size != outputs.size
            || outputs.none { it.id == defaultOutputId }
        ) return@runCatching null
        MobileProjectIndex(schemaVersion, projectId, displayName, updatedAt, defaultOutputId, outputs, commitSha)
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
        val immutableRef = item.commitSha ?: repository.commitSha
            ?: throw GitHubApiException("文件尚未固定到 Git 提交，请刷新项目后重试")
        require(COMMIT_SHA.matches(immutableRef)) { "Git 提交标识无效，请刷新项目后重试" }
        val apiUrl = "$apiRoot/repos/${encode(repository.owner)}/${encode(repository.name)}/contents/${encodePath(item.path)}?ref=${encode(immutableRef)}"
        val raw = "https://raw.githubusercontent.com/${encode(repository.owner)}/${encode(repository.name)}/${encode(immutableRef)}/${encodePath(item.path)}"
        val mediaUrl = "https://media.githubusercontent.com/media/${encode(repository.owner)}/${encode(repository.name)}/${encode(immutableRef)}/${encodePath(item.path)}"
        val direct = DownloadCandidate(raw, BINARY_ACCEPT)
        val media = DownloadCandidate(mediaUrl, BINARY_ACCEPT)
        val api = DownloadCandidate(apiUrl, RAW_ACCEPT)
        val ordered = if (repository.isPrivate) listOf(api, media, direct) else listOf(media, direct, api)
        return ordered.distinctBy(DownloadCandidate::url)
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

    private fun parseContent(value: JSONObject, commitSha: String? = null): GitHubContent {
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
            downloadUrl = value.optString("download_url").takeIf { it.isNotBlank() && it != "null" },
            commitSha = commitSha,
            gitObjectSha = value.optString("sha")
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
                throw requestFailure(
                    status,
                    bytes.toString(Charsets.UTF_8),
                    connection.getHeaderField("Retry-After"),
                    connection.getHeaderField("X-RateLimit-Reset")
                )
            }
            bytes
        } catch (failure: GitHubRequestException) {
            throw failure
        } catch (failure: SocketTimeoutException) {
            throw GitHubRequestException(
                RepositoryRefreshFailureKind.OFFLINE,
                "连接 GitHub 超时，请检查网络后重试",
                cause = failure
            )
        } catch (failure: IOException) {
            throw GitHubRequestException(
                RepositoryRefreshFailureKind.OFFLINE,
                "暂时无法连接 GitHub；已保留本地内容",
                cause = failure
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun postForm(url: String, fields: Map<String, String>): String {
        val body = fields.entries.joinToString("&") { (key, value) ->
            "${URLEncoder.encode(key, Charsets.UTF_8.name())}=${URLEncoder.encode(value, Charsets.UTF_8.name())}"
        }.toByteArray(Charsets.UTF_8)
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Accept", JSON_ACCEPT)
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            setRequestProperty("User-Agent", "LaTeX-Project-Viewer-Android")
            setFixedLengthStreamingMode(body.size)
        }
        return try {
            connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.use { readLimited(it, MAX_JSON_BYTES) }.orEmpty().toString(Charsets.UTF_8)
            if (status !in 200..299) throw requestFailure(status, response, null, null)
            response
        } catch (failure: GitHubRequestException) {
            throw failure
        } catch (failure: IOException) {
            throw GitHubRequestException(
                RepositoryRefreshFailureKind.OFFLINE,
                "暂时无法连接 GitHub 登录服务",
                cause = failure
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadWithFallback(
        candidates: List<DownloadCandidate>,
        token: String?,
        destination: File,
        expectPdf: Boolean,
        expectedSize: Long?,
        expectedGitBlobSha: String?,
        expectedLfsSha256: String?,
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
                verifyDownloadedObject(
                    destination,
                    expectedSize,
                    expectedGitBlobSha,
                    expectedLfsSha256
                )
                resumeMetadataFile(destination).delete()
                return
            } catch (failure: Throwable) {
                if (Thread.currentThread().isInterrupted) throw failure
                lastFailure = failure
                if (failure is InvalidDownloadContentException || failure is DownloadIntegrityException) {
                    destination.delete()
                    resumeMetadataFile(destination).delete()
                }
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
            val storedResume = readResumeMetadata(destination)
            if (destination.isFile && destination.length() > 0 && storedResume?.url != candidate.url) {
                destination.delete()
                resumeMetadataFile(destination).delete()
            }
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
                if (existing > 0) {
                    setRequestProperty("Range", "bytes=$existing-")
                    storedResume?.validator?.takeIf(String::isNotBlank)?.let {
                        setRequestProperty("If-Range", it)
                    }
                }
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
                    throw requestFailure(
                        status,
                        body,
                        connection.getHeaderField("Retry-After"),
                        connection.getHeaderField("X-RateLimit-Reset")
                    )
                }

                val appending = status == HttpURLConnection.HTTP_PARTIAL && existing > 0
                val downloadedBeforeRequest = if (appending) existing else 0L
                if (!appending && existing > 0) destination.delete()
                val validator = connection.getHeaderField("ETag")
                    ?: connection.getHeaderField("Last-Modified")
                writeResumeMetadata(destination, ResumeMetadata(candidate.url, validator))
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

    private fun verifyDownloadedObject(
        file: File,
        expectedSize: Long?,
        expectedGitBlobSha: String?,
        expectedLfsSha256: String?
    ) {
        if (expectedSize != null && expectedSize > 0 && file.length() != expectedSize) {
            throw DownloadIntegrityException("下载大小校验失败：预期 $expectedSize 字节，实际 ${file.length()} 字节")
        }
        expectedLfsSha256?.takeIf { SHA256.matches(it) }?.let { expected ->
            val actual = digestFile(file, "SHA-256")
            if (!actual.equals(expected, ignoreCase = true)) {
                throw DownloadIntegrityException("Git LFS SHA-256 校验失败，已保留旧的可用文件")
            }
            return
        }
        expectedGitBlobSha?.takeIf { GIT_OBJECT_SHA.matches(it) }?.let { expected ->
            val digest = MessageDigest.getInstance("SHA-1")
            digest.update("blob ${file.length()}\u0000".toByteArray(Charsets.UTF_8))
            file.inputStream().use { input ->
                val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (!actual.equals(expected, ignoreCase = true)) {
                throw DownloadIntegrityException("Git blob 校验失败，下载内容可能已改变")
            }
        }
    }

    private fun digestFile(file: File, algorithm: String): String {
        val digest = MessageDigest.getInstance(algorithm)
        file.inputStream().use { input ->
            val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun resumeMetadataFile(destination: File) = File(destination.parentFile, "${destination.name}.resume")

    private fun readResumeMetadata(destination: File): ResumeMetadata? = runCatching {
        val value = JSONObject(resumeMetadataFile(destination).readText(Charsets.UTF_8))
        ResumeMetadata(value.getString("url"), value.optString("validator").takeIf(String::isNotBlank))
    }.getOrNull()

    private fun writeResumeMetadata(destination: File, metadata: ResumeMetadata) {
        val target = resumeMetadataFile(destination)
        val temporary = File(target.parentFile, "${target.name}.tmp")
        temporary.writeText(
            JSONObject().put("url", metadata.url).put("validator", metadata.validator).toString(),
            Charsets.UTF_8
        )
        if (target.exists()) target.delete()
        if (!temporary.renameTo(target)) temporary.delete()
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

    private fun requestFailure(
        status: Int,
        body: String,
        retryAfterSeconds: String?,
        rateLimitResetSeconds: String?
    ): GitHubRequestException {
        val detail = runCatching { JSONObject(body).optString("message") }.getOrNull()
        val kind = when (status) {
            401 -> RepositoryRefreshFailureKind.AUTHENTICATION
            403 -> if (detail?.contains("rate limit", ignoreCase = true) == true) {
                RepositoryRefreshFailureKind.RATE_LIMITED
            } else RepositoryRefreshFailureKind.PERMISSION
            404 -> RepositoryRefreshFailureKind.NOT_FOUND
            in 500..599 -> RepositoryRefreshFailureKind.SERVER
            else -> RepositoryRefreshFailureKind.UNKNOWN
        }
        val now = System.currentTimeMillis()
        val retryAt = retryAfterSeconds?.toLongOrNull()?.let { now + it * 1_000L }
            ?: rateLimitResetSeconds?.toLongOrNull()?.times(1_000L)
        return GitHubRequestException(kind, errorMessage(status, body), status, retryAt)
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
        const val DEFAULT_API_ROOT = "https://api.github.com"
        const val DEFAULT_GITHUB_ROOT = "https://github.com"
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
        const val MAX_LFS_POINTER_BYTES = 2048L
        const val MAX_LFS_POINTER_JSON_BYTES = 32 * 1024
        const val MAX_RELEASE_MANIFEST_BYTES = 512 * 1024
        const val MAX_DOWNLOAD_BYTES = 4L * 1024 * 1024 * 1024
        const val MOBILE_INDEX_PATH = ".latex-project.json"
        const val UPDATE_REPOSITORY = "Ararataki-number-one/latex-project-manager"
        val ANDROID_VERSION = Regex("(?i)([0-9]+\\.[0-9]+\\.[0-9]+)(?=\\.apk$)")
        val REPOSITORY_PART = Regex("[A-Za-z0-9_.-]+")
        val COMMIT_SHA = Regex("(?i)[0-9a-f]{40,64}")
        val GIT_OBJECT_SHA = Regex("(?i)[0-9a-f]{40}")
        val SHA256 = Regex("(?i)[0-9a-f]{64}")
        val LFS_OID = Regex("(?m)^oid sha256:([0-9a-fA-F]{64})$")
        val LFS_SIZE = Regex("(?m)^size ([0-9]+)$")
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

open class GitHubApiException(message: String, cause: Throwable? = null) : Exception(message, cause)

class GitHubRequestException(
    val kind: RepositoryRefreshFailureKind,
    message: String,
    val statusCode: Int? = null,
    val retryAfterEpochMillis: Long? = null,
    cause: Throwable? = null
) : GitHubApiException(message, cause)

data class GitHubUser(val login: String, val avatarUrl: String?, val htmlUrl: String?)

data class GitHubDeviceAuthorization(
    val deviceCode: String,
    val userCode: String,
    val verificationUri: String,
    val expiresInSeconds: Long,
    val intervalSeconds: Long
)

sealed interface GitHubDeviceTokenResult {
    data class Authorized(val token: String) : GitHubDeviceTokenResult
    data class Failed(val message: String) : GitHubDeviceTokenResult
    data object Pending : GitHubDeviceTokenResult
    data object SlowDown : GitHubDeviceTokenResult
    data object Expired : GitHubDeviceTokenResult
    data object Denied : GitHubDeviceTokenResult
}

sealed interface MobileIndexFetchResult {
    data class Found(val index: MobileProjectIndex) : MobileIndexFetchResult
    data object Missing : MobileIndexFetchResult
    data object Malformed : MobileIndexFetchResult
}

private data class DownloadCandidate(val url: String, val accept: String)

private data class ResumeMetadata(val url: String, val validator: String?)

private class InvalidDownloadContentException(message: String) : Exception(message)

private class DownloadIntegrityException(message: String) : Exception(message)

private class SlowDownloadSourceException : Exception("当前 GitHub 下载源响应过慢，正在切换备用地址")
