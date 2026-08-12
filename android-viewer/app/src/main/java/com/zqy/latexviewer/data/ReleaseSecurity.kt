package com.zqy.latexviewer.data

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.Base64

data class VerifiedAndroidReleaseAsset(
    val version: String,
    val name: String,
    val size: Long,
    val sha256: String,
    val certificateSha256: String?
)

object ReleaseSecurity {
    const val MANIFEST_NAME = "release-manifest.json"
    const val KEY_ID = "latex-project-manager-release-ed25519-v1"
    private const val PUBLIC_KEY_SPKI_BASE64 = "MCowBQYDK2VwAyEAtV59lxrNW/B2niEJnKxTa/bR8s6ZI7am35NAK2bY094="

    internal fun verifyManifest(
        raw: String,
        expectedTag: String,
        publicKeySubjectPublicKeyInfo: ByteArray = Base64.getDecoder().decode(PUBLIC_KEY_SPKI_BASE64)
    ): VerifiedAndroidReleaseAsset {
        val root = JSONObject(raw)
        val payload = Base64.getDecoder().decode(root.getString("payload"))
        val signed = JSONObject(String(payload, Charsets.UTF_8))
        val signature = root.getJSONObject("signature")
        val expectedVersion = RELEASE_TAG.matchEntire(expectedTag)?.groupValues?.get(1)
            ?: throw IllegalArgumentException("GitHub Release 标签格式无效")
        require(signed.optInt("schemaVersion") == 1) { "更新清单版本不受支持" }
        require(signed.getString("keyId") == KEY_ID) { "更新清单密钥不受信任" }
        require(signature.getString("algorithm") == "Ed25519") { "更新签名算法不受支持" }
        require(signature.getString("keyId") == KEY_ID) { "更新签名密钥不匹配" }
        require(signed.getString("tag") == expectedTag) { "更新清单与 GitHub Release 不一致" }
        require(signed.getString("version") == expectedVersion) { "更新清单版本与 GitHub Release 不一致" }

        val signatureBytes = Base64.getDecoder().decode(signature.getString("value"))
        require(signatureBytes.size == ED25519_SIGNATURE_SIZE &&
            verifyEd25519(payload, signatureBytes, publicKeySubjectPublicKeyInfo)) {
            "更新清单签名验证失败，已拒绝自动更新"
        }

        val assets = signed.getJSONArray("assets")
        var android: VerifiedAndroidReleaseAsset? = null
        for (index in 0 until assets.length()) {
            val value = assets.getJSONObject(index)
            if (value.optString("kind") != "android-apk") continue
            require(android == null) { "更新清单包含重复 Android 安装包" }
            val name = value.getString("name")
            val size = value.getLong("size")
            val sha256 = value.getString("sha256").lowercase()
            val certificate = value.optString("certificateSha256").takeIf(String::isNotBlank)
                ?.replace(Regex("[^A-Fa-f0-9]"), "")?.lowercase()
            require('/' !in name && '\\' !in name && name.endsWith(".apk", true)) { "Android 安装包名称无效" }
            require(size > 0 && SHA256.matches(sha256)) { "Android 安装包校验信息无效" }
            require(certificate == null || SHA256.matches(certificate)) { "Android 签名证书指纹无效" }
            android = VerifiedAndroidReleaseAsset(expectedVersion, name, size, sha256, certificate)
        }
        return requireNotNull(android) { "签名清单中没有 Android 安装包" }
    }

    fun verifyDownloadedApk(
        context: Context,
        apk: File,
        expected: VerifiedAndroidReleaseAsset
    ) {
        require(apk.isFile && apk.length() == expected.size) { "Android 安装包大小校验失败" }
        require(digest(apk).equals(expected.sha256, true)) { "Android 安装包 SHA-256 校验失败" }
        val archive = packageArchiveInfo(context, apk)
            ?: throw IllegalStateException("无法读取 Android 安装包签名")
        val installed = installedPackageInfo(context)
        val archiveSigners = signerDigests(archive)
        val installedSigners = signerDigests(installed)
        require(archiveSigners.isNotEmpty() && archiveSigners == installedSigners) {
            "Android 安装包签名与当前应用不一致，已拒绝安装"
        }
        expected.certificateSha256?.let { expectedCertificate ->
            require(expectedCertificate in archiveSigners) { "Android 安装包证书指纹与发布清单不一致" }
        }
    }

    private fun digest(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    internal fun verifyEd25519(
        payload: ByteArray,
        signature: ByteArray,
        publicKeySubjectPublicKeyInfo: ByteArray
    ): Boolean {
        val rawPublicKey = rawEd25519PublicKey(publicKeySubjectPublicKeyInfo)
        val verifier = Ed25519Signer()
        verifier.init(false, Ed25519PublicKeyParameters(rawPublicKey, 0))
        verifier.update(payload, 0, payload.size)
        return verifier.verifySignature(signature)
    }

    private fun rawEd25519PublicKey(subjectPublicKeyInfo: ByteArray): ByteArray {
        require(subjectPublicKeyInfo.size == ED25519_SPKI_PREFIX.size + Ed25519PublicKeyParameters.KEY_SIZE &&
            subjectPublicKeyInfo.copyOfRange(0, ED25519_SPKI_PREFIX.size).contentEquals(ED25519_SPKI_PREFIX)) {
            "更新清单公钥格式无效"
        }
        return subjectPublicKeyInfo.copyOfRange(ED25519_SPKI_PREFIX.size, subjectPublicKeyInfo.size)
    }

    @Suppress("DEPRECATION")
    private fun packageArchiveInfo(context: Context, apk: File): PackageInfo? = when {
        Build.VERSION.SDK_INT >= 33 -> context.packageManager.getPackageArchiveInfo(
            apk.absolutePath,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
        )
        Build.VERSION.SDK_INT >= 28 -> context.packageManager.getPackageArchiveInfo(
            apk.absolutePath,
            PackageManager.GET_SIGNING_CERTIFICATES
        )
        else -> context.packageManager.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNATURES)
    }

    @Suppress("DEPRECATION")
    private fun installedPackageInfo(context: Context): PackageInfo = when {
        Build.VERSION.SDK_INT >= 33 -> context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
        )
        Build.VERSION.SDK_INT >= 28 -> context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_SIGNING_CERTIFICATES
        )
        else -> context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
    }

    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo): Set<String> {
        val signers = if (Build.VERSION.SDK_INT >= 28) {
            info.signingInfo?.apkContentsSigners.orEmpty()
        } else {
            info.signatures.orEmpty()
        }
        return signers.map { sha256(it.toByteArray()) }.toSet()
    }

    private val RELEASE_TAG = Regex("v([0-9]+\\.[0-9]+\\.[0-9]+)")
    private val SHA256 = Regex("[a-f0-9]{64}")
    private const val ED25519_SIGNATURE_SIZE = 64
    private val ED25519_SPKI_PREFIX = byteArrayOf(
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    )
}
