package com.zqy.latexviewer.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLDecoder

class GitHubDeviceFlowTest {
    @Test
    fun `GitHub App device authorization relies on configured read-only permissions`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """{
                        "device_code":"device-code",
                        "user_code":"ABCD-EFGH",
                        "verification_uri":"https://github.com/login/device",
                        "expires_in":900,
                        "interval":5
                    }""".trimIndent()
                )
        )
        server.start()
        try {
            val root = server.url("/").toString().removeSuffix("/")
            val authorization = GitHubApi(apiRoot = root, githubRoot = root)
                .startDeviceFlow("github-app-client-id")
            val request = server.takeRequest()
            val fields = request.body.readUtf8()
                .split('&')
                .filter(String::isNotBlank)
                .associate { part ->
                    val key = part.substringBefore('=')
                    val value = part.substringAfter('=', "")
                    URLDecoder.decode(key, Charsets.UTF_8.name()) to
                        URLDecoder.decode(value, Charsets.UTF_8.name())
                }

            assertEquals("/login/device/code", request.path)
            assertEquals("github-app-client-id", fields["client_id"])
            assertFalse(fields.containsKey("scope"))
            assertEquals("device-code", authorization.deviceCode)
            assertTrue(authorization.intervalSeconds >= 5L)
        } finally {
            server.shutdown()
        }
    }
}
