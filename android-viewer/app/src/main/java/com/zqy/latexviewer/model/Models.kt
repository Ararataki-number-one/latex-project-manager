package com.zqy.latexviewer.model

data class GitHubRepository(
    val name: String,
    val fullName: String,
    val owner: String,
    val description: String?,
    val isPrivate: Boolean,
    val defaultBranch: String,
    val updatedAt: String,
    val htmlUrl: String,
    val sizeKb: Long,
    /** Immutable commit currently backing the cached snapshot, when known. */
    val commitSha: String? = null,
    val lastSuccessfulRefreshAt: Long = 0L
) {
    val stableId: String get() = fullName.lowercase()
}

data class GitHubCommitSnapshot(
    val repositoryFullName: String,
    val commitSha: String,
    val treeSha: String?,
    val resolvedAt: Long = System.currentTimeMillis()
)

enum class RepositoryRefreshFailureKind {
    OFFLINE,
    RATE_LIMITED,
    AUTHENTICATION,
    PERMISSION,
    NOT_FOUND,
    MALFORMED,
    SERVER,
    UNKNOWN
}

data class RepositoryRefreshFailure(
    val kind: RepositoryRefreshFailureKind,
    val message: String,
    val retryAfterEpochMillis: Long? = null
)

enum class GitHubContentKind {
    DIRECTORY,
    FILE,
    SYMLINK,
    SUBMODULE,
    UNKNOWN
}

data class GitHubContent(
    val name: String,
    val path: String,
    val kind: GitHubContentKind,
    val size: Long,
    val sha: String,
    val htmlUrl: String?,
    val downloadUrl: String?,
    /** Commit used to resolve this entry. Downloads must not fall back to a moving branch. */
    val commitSha: String? = null,
    val gitObjectSha: String = sha,
    val etag: String? = null,
    val lfsOidSha256: String? = null
)

data class TextDocument(
    val name: String,
    val path: String,
    val content: String,
    val htmlUrl: String?
)

data class PdfDocument(
    val name: String,
    val path: String,
    val htmlUrl: String?,
    val localPath: String? = null,
    val contentUri: String? = null,
    val repositoryFullName: String? = null,
    val sha: String? = null,
    val commitSha: String? = null,
    val blobSha: String? = sha,
    val expectedSize: Long? = null,
    val initialPage: Int = 0,
    val openedAt: Long = System.nanoTime()
)

data class MobilePdfOutput(
    val id: String,
    val targetId: String,
    val name: String,
    val entry: String,
    val profileId: String?,
    val pdfPath: String
)

data class MobileProjectIndex(
    val schemaVersion: Int,
    val projectId: String,
    val name: String,
    val updatedAt: String,
    val defaultOutputId: String,
    val outputs: List<MobilePdfOutput>,
    /** Commit from which both the index and every output path were resolved. */
    val commitSha: String? = null
) {
    val defaultOutput: MobilePdfOutput?
        get() = outputs.firstOrNull { it.id == defaultOutputId }
}

data class ReadingProgress(
    val schemaVersion: Int = 1,
    val repositoryFullName: String,
    val projectName: String,
    val pdfPath: String,
    val pdfName: String,
    val sha: String,
    val pageIndex: Int,
    val pageCount: Int,
    val lastReadAt: Long
) {
    val documentId: String
        get() = "${repositoryFullName.lowercase()}:${pdfPath.replace('\\', '/').trimStart('/')}"
}

data class PdfBookmark(
    val repositoryFullName: String,
    val pdfPath: String,
    val pageIndex: Int,
    val label: String? = null,
    val createdAt: Long = System.currentTimeMillis()
) {
    val stableId: String
        get() = "${repositoryFullName.lowercase()}:${pdfPath.replace('\\', '/').trimStart('/')}:$pageIndex"
}

enum class PersistentDownloadState {
    QUEUED,
    RUNNING,
    WAITING_FOR_NETWORK,
    SUCCEEDED,
    FAILED,
    CANCELLED
}

enum class PersistentDownloadKind {
    FILE,
    PROJECT_ARCHIVE,
    PDF_PREVIEW,
    APP_UPDATE
}

enum class GlassMode {
    AUTO,
    FULL,
    OFF
}

data class PersistentDownloadTask(
    val id: String,
    val uniqueKey: String,
    val name: String,
    val kind: PersistentDownloadKind,
    val state: PersistentDownloadState,
    val downloaded: Long = 0L,
    val total: Long = -1L,
    val bytesPerSecond: Long = 0L,
    val repositoryFullName: String? = null,
    val path: String? = null,
    val commitSha: String? = null,
    val blobSha: String? = null,
    val error: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = createdAt
)

enum class DownloadHistoryKind {
    PROJECT_ARCHIVE,
    PDF,
    SOURCE_FILE,
    APP_PACKAGE,
    OTHER
}

data class DownloadedFile(
    val name: String,
    val contentUri: String,
    val displayPath: String,
    val mimeType: String,
    val size: Long,
    val id: String = contentUri,
    val downloadedAt: Long = 0L,
    val kind: DownloadHistoryKind = inferDownloadHistoryKind(name, mimeType),
    val sourceRepository: String? = null,
    val sourcePath: String? = null
) {
    val stableId: String
        get() = id.ifBlank { contentUri }
}

fun inferDownloadHistoryKind(name: String, mimeType: String): DownloadHistoryKind {
    val extension = name.substringAfterLast('.', "").lowercase()
    return when {
        extension == "pdf" || mimeType.equals("application/pdf", ignoreCase = true) ->
            DownloadHistoryKind.PDF
        extension == "apk" || mimeType.equals("application/vnd.android.package-archive", ignoreCase = true) ->
            DownloadHistoryKind.APP_PACKAGE
        extension == "zip" || mimeType.equals("application/zip", ignoreCase = true) ->
            DownloadHistoryKind.PROJECT_ARCHIVE
        extension in setOf(
            "tex", "bib", "cls", "sty", "bst", "bbx", "cbx", "ltx", "dtx", "ins",
            "md", "txt", "json", "yaml", "yml", "toml", "xml", "csv", "py", "r"
        ) || mimeType.startsWith("text/", ignoreCase = true) -> DownloadHistoryKind.SOURCE_FILE
        else -> DownloadHistoryKind.OTHER
    }
}

data class AndroidReleaseAsset(
    val version: String,
    val releaseTag: String,
    val releaseUrl: String,
    val name: String,
    val apiUrl: String,
    val downloadUrl: String,
    val size: Long,
    val sha256: String?,
    val manifestVerified: Boolean = false,
    val certificateSha256: String? = null
)
