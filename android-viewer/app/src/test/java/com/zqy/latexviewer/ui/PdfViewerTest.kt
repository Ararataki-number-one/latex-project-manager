package com.zqy.latexviewer.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PdfViewerTest {
    @Test
    fun renderSizePreservesAspectRatioWithinPixelBudget() {
        val (width, height) = calculateRenderSize(
            pageWidth = 595,
            pageHeight = 842,
            requestedWidth = 1_800,
            maximumWidth = 1_800,
            maximumPixels = 3_200_000L
        )

        assertTrue(width in 1..1_800)
        assertTrue(width.toLong() * height <= 3_200_000L)
        assertEquals(595f / 842f, width.toFloat() / height, 0.01f)
    }

    @Test
    fun renderSizeHonorsRequestedWidthForSmallViewport() {
        val (width, height) = calculateRenderSize(
            pageWidth = 600,
            pageHeight = 900,
            requestedWidth = 420,
            maximumWidth = 1_800,
            maximumPixels = 3_200_000L
        )

        assertEquals(420, width)
        assertEquals(630, height)
    }

    @Test
    fun zoomIsClampedToReaderSafetyBounds() {
        assertEquals(1f, clampPdfZoom(0.2f), 0f)
        assertEquals(2.25f, clampPdfZoom(2.25f), 0f)
        assertEquals(3.5f, clampPdfZoom(9f), 0f)
    }
}
