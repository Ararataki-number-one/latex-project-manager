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
    val sizeKb: Long
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
    val downloadUrl: String?
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
    val outputs: List<MobilePdfOutput>
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
)

data class DownloadedFile(
    val name: String,
    val contentUri: String,
    val displayPath: String,
    val mimeType: String,
    val size: Long
)

data class AndroidReleaseAsset(
    val version: String,
    val releaseTag: String,
    val releaseUrl: String,
    val name: String,
    val apiUrl: String,
    val downloadUrl: String,
    val size: Long,
    val sha256: String?
)
