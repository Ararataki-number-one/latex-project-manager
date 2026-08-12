package com.zqy.latexviewer.data

import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadStoreNameTest {
    @Test
    fun `long repository prefix cannot collapse distinct immutable versions`() {
        val prefix = "owner-" + "very-long-repository-name-".repeat(8)
        val first = stablePdfCacheFileName("$prefix-${"1".repeat(40)}.pdf")
        val second = stablePdfCacheFileName("$prefix-${"2".repeat(40)}.pdf")

        assertNotEquals(first, second)
        assertTrue(first.endsWith(".pdf"))
        assertTrue(first.length < 120)
    }
}
