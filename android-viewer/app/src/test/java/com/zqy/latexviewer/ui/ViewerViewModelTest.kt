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
    fun validatesMobileProjectIndexAndRejectsUnsafePdfPaths() {
        val valid = """{
          "schemaVersion":1,
          "projectId":"project-one",
          "name":"Graph Notes",
          "updatedAt":"2026-08-11T00:00:00.000Z",
          "defaultOutputId":"mobile-main",
          "outputs":[{
            "id":"mobile-main",
            "name":"Main",
            "targetId":"main",
            "entry":"main.tex",
            "profileId":"full",
            "pdfPath":"output/main.pdf"
          }]
        }""".trimIndent()
        assertEquals("output/main.pdf", GitHubApi().parseMobileProjectIndex(valid)?.defaultOutput?.pdfPath)
        assertEquals(null, GitHubApi().parseMobileProjectIndex(valid.replace("output/main.pdf", "../secret.pdf")))
        assertEquals(null, GitHubApi().parseMobileProjectIndex(valid.replace("output/main.pdf", "output/main.tex")))
    }
}
