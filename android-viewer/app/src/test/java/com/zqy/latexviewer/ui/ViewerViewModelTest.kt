package com.zqy.latexviewer.ui

import com.zqy.latexviewer.data.GitHubApi
import com.zqy.latexviewer.model.GitHubContent
import com.zqy.latexviewer.model.GitHubContentKind
import com.zqy.latexviewer.model.GitHubRepository
import com.zqy.latexviewer.model.DownloadHistoryKind
import com.zqy.latexviewer.model.inferDownloadHistoryKind
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewerViewModelTest {
    @Test
    fun comparesSemanticVersionsForInAppUpdates() {
        assertTrue(ViewerViewModel.isNewerVersion("0.2.0", "0.1.0"))
        assertTrue(ViewerViewModel.isNewerVersion("v1.0.0", "0.9.9"))
        assertFalse(ViewerViewModel.isNewerVersion("0.2.0", "0.2.0"))
        assertFalse(ViewerViewModel.isNewerVersion("0.1.9", "0.2.0"))
    }

    @Test
    fun recognizesPdfAndDownloadMimeTypes() {
        assertTrue(ViewerViewModel.isPdfFile("reference.PDF"))
        assertFalse(ViewerViewModel.isPdfFile("notes.tex"))
        assertEquals("application/pdf", ViewerViewModel.mimeTypeFor("paper.pdf"))
        assertEquals("text/x-tex", ViewerViewModel.mimeTypeFor("main.tex"))
        assertEquals("application/zip", ViewerViewModel.mimeTypeFor("project.zip"))
    }

    @Test
    fun validatesMobilePdfPathsWithoutAndroidRuntimeDependencies() {
        val api = GitHubApi()
        assertTrue(api.isSafePdfPath("output/main.pdf"))
        assertTrue(api.isSafePdfPath("中文目录/讲义.PDF"))
        assertFalse(api.isSafePdfPath("../secret.pdf"))
        assertFalse(api.isSafePdfPath("C:/secret.pdf"))
        assertFalse(api.isSafePdfPath("/secret.pdf"))
        assertFalse(api.isSafePdfPath("output/main.tex"))
    }

    @Test
    fun prefersGithubMediaHostForBinaryAndLfsDownloads() {
        val api = GitHubApi()
        assertEquals(
            "https://media.githubusercontent.com/media/owner/repo/main/output/book.pdf",
            api.preferredDownloadUrl("https://raw.githubusercontent.com/owner/repo/main/output/book.pdf")
        )
        assertEquals(
            "https://media.githubusercontent.com/media/owner/repo/main/output/book.pdf",
            api.preferredDownloadUrl("https://media.githubusercontent.com/media/owner/repo/main/output/book.pdf")
        )
        assertEquals(null, api.preferredDownloadUrl("https://example.com/book.pdf"))
    }

    @Test
    fun providesFallbackDownloadSourcesAndPrioritizesAuthenticatedApiForPrivateRepositories() {
        val api = GitHubApi()
        val item = GitHubContent(
            name = "book.pdf",
            path = "output/book.pdf",
            kind = GitHubContentKind.FILE,
            size = 10_000_000,
            sha = "blob-sha",
            htmlUrl = null,
            downloadUrl = "https://raw.githubusercontent.com/owner/repo/main/output/book.pdf",
            commitSha = "0123456789abcdef0123456789abcdef01234567"
        )
        val publicRepository = repository(isPrivate = false)
        val privateRepository = repository(isPrivate = true)

        val publicSources = api.downloadUrlCandidates(publicRepository, item)
        assertEquals("media.githubusercontent.com", java.net.URL(publicSources.first()).host)
        assertTrue(publicSources.any { it.startsWith("https://api.github.com/") })

        val privateSources = api.downloadUrlCandidates(privateRepository, item)
        assertTrue(privateSources.first().startsWith("https://api.github.com/"))
        assertTrue(privateSources.size >= 2)
    }

    @Test
    fun capsPdfRenderMemoryForVeryLargeAndTallPages() {
        val normal = calculateRenderSize(595, 842, 1440)
        assertTrue(normal.first <= 1800)
        assertTrue(normal.first.toLong() * normal.second <= 3_200_000L)

        val tall = calculateRenderSize(100, 100_000, 1080)
        assertTrue(tall.first > 0 && tall.second > 0)
        assertTrue(tall.first.toLong() * tall.second <= 3_200_000L)
    }

    @Test
    fun classifiesEveryDownloadHistoryType() {
        assertEquals(DownloadHistoryKind.PDF, inferDownloadHistoryKind("paper.PDF", "application/octet-stream"))
        assertEquals(DownloadHistoryKind.PROJECT_ARCHIVE, inferDownloadHistoryKind("notes.zip", "application/zip"))
        assertEquals(DownloadHistoryKind.SOURCE_FILE, inferDownloadHistoryKind("chapter.tex", "text/x-tex"))
        assertEquals(
            DownloadHistoryKind.APP_PACKAGE,
            inferDownloadHistoryKind("LaTeX.Android.apk", "application/vnd.android.package-archive")
        )
        assertEquals(DownloadHistoryKind.OTHER, inferDownloadHistoryKind("font.ttf", "font/ttf"))
    }

    private fun repository(isPrivate: Boolean) = GitHubRepository(
        name = "repo",
        fullName = "owner/repo",
        owner = "owner",
        description = null,
        isPrivate = isPrivate,
        defaultBranch = "main",
        updatedAt = "",
        htmlUrl = "https://github.com/owner/repo",
        sizeKb = 0
    )
}
