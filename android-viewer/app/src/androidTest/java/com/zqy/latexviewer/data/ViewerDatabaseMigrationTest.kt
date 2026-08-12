package com.zqy.latexviewer.data

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ViewerDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        ViewerDatabase::class.java.canonicalName,
        FrameworkSQLiteOpenHelperFactory()
    )

    @Test
    fun migrate1To2PreservesKnownGoodPdfAndMarksItTemporary() {
        helper.createDatabase(TEST_DATABASE, 1).apply {
            execSQL(
                """
                INSERT INTO pdf_cache(
                    cacheKey, localPath, size, lastAccessAt,
                    repositoryFullName, pdfPath, sha, knownGood
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                arrayOf<Any>(
                    "owner-repo-blob.pdf",
                    "/data/user/0/com.zqy.latexviewer/cache/pdf-preview/book.pdf",
                    2048L,
                    1_723_400_000_000L,
                    "owner/repo",
                    "build/book.pdf",
                    "1111111111111111111111111111111111111111",
                    1
                )
            )
            close()
        }

        helper.runMigrationsAndValidate(
            TEST_DATABASE,
            2,
            true,
            ViewerDatabase.MIGRATION_1_2
        ).use { database ->
            database.query(
                "SELECT cacheKey, size, knownGood, storageClass FROM pdf_cache WHERE cacheKey = ?",
                arrayOf("owner-repo-blob.pdf")
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("owner-repo-blob.pdf", cursor.getString(0))
                assertEquals(2048L, cursor.getLong(1))
                assertEquals(1, cursor.getInt(2))
                assertEquals("TEMPORARY", cursor.getString(3))
            }
        }
    }

    private companion object {
        const val TEST_DATABASE = "viewer-migration-test"
    }
}
