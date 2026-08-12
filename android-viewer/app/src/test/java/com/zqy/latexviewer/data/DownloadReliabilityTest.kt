package com.zqy.latexviewer.data

import androidx.work.WorkInfo
import com.zqy.latexviewer.model.AndroidReleaseAsset
import com.zqy.latexviewer.model.PersistentDownloadState
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import kotlin.io.path.createTempDirectory

class DownloadReliabilityTest {
    @Test
    fun `resumable fragments use the immutable task identity`() {
        val first = stableDownloadIdentity("update:1.0.1:abc")
        val same = stableDownloadIdentity("update:1.0.1:abc")
        val next = stableDownloadIdentity("update:1.0.2:def")

        assertEquals(first, same)
        assertNotEquals(first, next)
        assertEquals(64, first.length)
    }

    @Test
    fun `persisted progress never disappears when WorkManager reports zero`() {
        assertEquals(8_000_000L, mergeDownloadedBytes(8_000_000L, 0L))
        assertEquals(9_000_000L, mergeDownloadedBytes(8_000_000L, 9_000_000L))
        assertEquals(20_000_000L, mergeDownloadTotal(20_000_000L, -1L))
    }

    @Test
    fun `only explicit cancellation becomes cancelled`() {
        assertEquals(
            PersistentDownloadState.WAITING_FOR_NETWORK,
            persistentStateFor(WorkInfo.State.CANCELLED, PersistentDownloadState.RUNNING)
        )
        assertEquals(
            PersistentDownloadState.CANCELLED,
            persistentStateFor(WorkInfo.State.CANCELLED, PersistentDownloadState.CANCELLED)
        )
    }

    @Test
    fun `android update resumes with range and if-range`() = runBlocking {
        val server = MockWebServer()
        server.start()
        val directory = createTempDirectory("update-resume-").toFile()
        try {
            val payload = ByteArray(128 * 1024) { index -> (index % 251).toByte() }
            val split = 32 * 1024
            val destination = File(directory, "update.part")
            destination.writeBytes(payload.copyOfRange(0, split))
            val sha256 = MessageDigest.getInstance("SHA-256")
                .digest(payload)
                .joinToString("") { "%02x".format(it) }
            val url = server.url("/release/app.apk").toString()
            File(directory, "${destination.name}.resume").writeText(
                JSONObject()
                    .put("url", url)
                    .put("validator", "\"release-v1\"")
                    .put("identity", "sha256:$sha256")
                    .toString(),
                Charsets.UTF_8
            )
            server.enqueue(
                MockResponse()
                    .setResponseCode(206)
                    .setHeader("Content-Range", "bytes $split-${payload.lastIndex}/${payload.size}")
                    .setHeader("ETag", "\"release-v1\"")
                    .setBody(okio.Buffer().write(payload, split, payload.size - split))
            )
            val asset = AndroidReleaseAsset(
                version = "1.0.1",
                releaseTag = "v1.0.1",
                releaseUrl = "https://example.invalid/v1.0.1",
                name = "latex.apk",
                apiUrl = url,
                downloadUrl = url,
                size = payload.size.toLong(),
                sha256 = sha256,
                manifestVerified = true
            )
            val api = GitHubApi(
                apiRoot = server.url("/").toString().removeSuffix("/"),
                githubRoot = server.url("/").toString().removeSuffix("/"),
                releaseChannel = "stable",
                allowLocalHttpDownloadsForTests = true
            )

            api.downloadAndroidUpdate(asset, destination) { _, _ -> }

            val request = server.takeRequest()
            assertEquals("bytes=$split-", request.getHeader("Range"))
            assertEquals("\"release-v1\"", request.getHeader("If-Range"))
            assertArrayEquals(payload, destination.readBytes())
        } finally {
            directory.deleteRecursively()
            server.shutdown()
        }
    }
}
