package com.zqy.latexviewer.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class GitHubApiReleaseTest {
    @Test
    fun `downloads the signed release manifest as an attachment`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val manifestUrl = server.url("/release-assets/manifest").toString()
            val release = JSONObject()
                .put("tag_name", "v0.11.0")
                .put("html_url", "https://example.invalid/release")
                .put(
                    "assets",
                    JSONArray().put(
                        JSONObject()
                            .put("name", ReleaseSecurity.MANIFEST_NAME)
                            .put("url", manifestUrl)
                    )
                )
            server.enqueue(
                MockResponse()
                    .setHeader("Content-Type", "application/json")
                    .setBody(release.toString())
            )
            server.enqueue(
                MockResponse()
                    .setHeader("Content-Type", "application/octet-stream")
                    .setBody("{}")
            )
            val root = server.url("/").toString().removeSuffix("/")
            val api = GitHubApi(apiRoot = root, githubRoot = root)

            val failure = runCatching { api.latestAndroidRelease() }.exceptionOrNull()

            assertNotNull(failure)
            server.takeRequest()
            val manifestRequest = server.takeRequest()
            assertEquals("application/octet-stream", manifestRequest.getHeader("Accept"))
        } finally {
            server.shutdown()
        }
    }
}
