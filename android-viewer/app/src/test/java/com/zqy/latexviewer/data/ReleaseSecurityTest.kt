package com.zqy.latexviewer.data

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

class ReleaseSecurityTest {
    @Test
    fun `verifies a signed manifest with the bundled lightweight verifier`() {
        val fixture = manifestFixture(version = "0.11.0", tag = "v0.11.0")

        val asset = ReleaseSecurity.verifyManifest(fixture.json, "v0.11.0", fixture.publicKeySpki)

        assertEquals("0.11.0", asset.version)
        assertEquals("LaTeX.Android.0.11.0.apk", asset.name)
        assertEquals(1024L, asset.size)
        assertEquals("ab".repeat(32), asset.sha256)
        assertEquals("cd".repeat(32), asset.certificateSha256)
    }

    @Test
    fun `rejects a payload changed after signing`() {
        val fixture = manifestFixture(version = "0.11.0", tag = "v0.11.0")
        val root = JSONObject(fixture.json)
        val payload = Base64.getDecoder().decode(root.getString("payload"))
        val changed = String(payload, Charsets.UTF_8)
            .replace("LaTeX.Android.0.11.0.apk", "LaTeX.Android.0.11.1.apk")
            .toByteArray(Charsets.UTF_8)
        root.put("payload", Base64.getEncoder().encodeToString(changed))

        assertThrows(IllegalArgumentException::class.java) {
            ReleaseSecurity.verifyManifest(root.toString(), "v0.11.0", fixture.publicKeySpki)
        }
    }

    @Test
    fun `rejects a signed manifest whose version differs from its release tag`() {
        val fixture = manifestFixture(version = "0.11.1", tag = "v0.11.0")

        assertThrows(IllegalArgumentException::class.java) {
            ReleaseSecurity.verifyManifest(fixture.json, "v0.11.0", fixture.publicKeySpki)
        }
    }

    private fun manifestFixture(version: String, tag: String): Fixture {
        val seed = ByteArray(Ed25519PrivateKeyParameters.KEY_SIZE) { index -> (index + 1).toByte() }
        val privateKey = Ed25519PrivateKeyParameters(seed, 0)
        val publicKey = privateKey.generatePublicKey().encoded
        val publicKeySpki = ED25519_SPKI_PREFIX + publicKey
        val asset = JSONObject()
            .put("kind", "android-apk")
            .put("name", "LaTeX.Android.0.11.0.apk")
            .put("size", 1024)
            .put("sha256", "ab".repeat(32))
            .put("certificateSha256", "cd".repeat(32))
        val signed = JSONObject()
            .put("schemaVersion", 1)
            .put("keyId", ReleaseSecurity.KEY_ID)
            .put("version", version)
            .put("tag", tag)
            .put("generatedAt", "2026-08-12T00:00:00.000Z")
            .put("assets", JSONArray().put(asset))
        val payload = signed.toString().toByteArray(Charsets.UTF_8)
        val signer = Ed25519Signer()
        signer.init(true, privateKey)
        signer.update(payload, 0, payload.size)
        val signature = signer.generateSignature()
        val root = JSONObject()
            .put("signed", signed)
            .put("payload", Base64.getEncoder().encodeToString(payload))
            .put(
                "signature",
                JSONObject()
                    .put("algorithm", "Ed25519")
                    .put("keyId", ReleaseSecurity.KEY_ID)
                    .put("value", Base64.getEncoder().encodeToString(signature))
            )
        return Fixture(root.toString(), publicKeySpki)
    }

    private data class Fixture(val json: String, val publicKeySpki: ByteArray)

    private companion object {
        val ED25519_SPKI_PREFIX = byteArrayOf(
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
        )
    }
}
