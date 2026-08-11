package com.zqy.latexviewer.ui

import org.junit.Assert.assertFalse
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
}
