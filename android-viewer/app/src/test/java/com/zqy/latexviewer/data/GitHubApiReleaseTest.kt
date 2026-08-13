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
            // This test exercises the stable `/releases/latest` contract in
            // both product flavors. Do not inherit the Beta BuildConfig
            // channel, otherwise the fixture provides the wrong endpoint and
            // the second takeRequest would wait forever.
            val api = GitHubApi(apiRoot = root, githubRoot = root, releaseChannel = "stable")

            val failure = runCatching { api.latestAndroidRelease() }.exceptionOrNull()

            assertNotNull(failure)
            server.takeRequest()
            val manifestRequest = server.takeRequest()
            assertEquals("application/octet-stream", manifestRequest.getHeader("Accept"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `beta channel reads prereleases instead of latest stable release`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val manifestUrl = server.url("/release-assets/beta-manifest").toString()
            val releases = JSONArray()
                .put(
                    JSONObject()
                        .put("tag_name", "v0.11.1")
                        .put("prerelease", false)
                        .put("draft", false)
                        .put("assets", JSONArray())
                )
                .put(
                    JSONObject()
                        .put("tag_name", "v1.0.0-beta.1")
                        .put("prerelease", true)
                        .put("draft", false)
                        .put("assets", JSONArray())
                )
                .put(
                    JSONObject()
                        .put("tag_name", "v1.0.0-beta.2")
                        .put("prerelease", true)
                        .put("draft", false)
                        .put(
                            "assets",
                            JSONArray().put(
                                JSONObject()
                                    .put("name", ReleaseSecurity.MANIFEST_NAME)
                                    .put("url", manifestUrl)
                            )
                        )
                )
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(releases.toString()))
            server.enqueue(MockResponse().setHeader("Content-Type", "application/octet-stream").setBody("{}"))
            val root = server.url("/").toString().removeSuffix("/")
            val api = GitHubApi(apiRoot = root, githubRoot = root, releaseChannel = "beta")

            val failure = runCatching { api.latestAndroidRelease() }.exceptionOrNull()

            assertNotNull(failure)
            assertEquals(
                "/repos/Ararataki-number-one/latex-project-manager/releases?per_page=30",
                server.takeRequest().path
            )
            assertEquals("/release-assets/beta-manifest", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }
}
