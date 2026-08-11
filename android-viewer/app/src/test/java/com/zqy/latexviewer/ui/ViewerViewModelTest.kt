package com.zqy.latexviewer.ui

import com.zqy.latexviewer.data.GitHubApi
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
}
