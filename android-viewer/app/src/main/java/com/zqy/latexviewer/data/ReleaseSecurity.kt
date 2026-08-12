package com.zqy.latexviewer.data

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

data class VerifiedAndroidReleaseAsset(
    val name: String,
    val size: Long,
    val sha256: String,
    val certificateSha256: String?
)

object ReleaseSecurity {
    const val MANIFEST_NAME = "release-manifest.json"
    const val KEY_ID = "latex-project-manager-release-ed25519-v1"
    private const val PUBLIC_KEY_BASE64 = "MCowBQYDK2VwAyEAtV59lxrNW/B2niEJnKxTa/bR8s6ZI7am35NAK2bY094="

    fun verifyManifest(raw: String, expectedTag: String): VerifiedAndroidReleaseAsset {
        val root = JSONObject(raw)
        val payload = Base64.getDecoder().decode(root.getString("payload"))
        val signed = JSONObject(String(payload, Charsets.UTF_8))
        val signature = root.getJSONObject("signature")
        require(signed.optInt("schemaVersion") == 1) { "更新清单版本不受支持" }
        require(signed.getString("keyId") == KEY_ID) { "更新清单密钥不受信任" }
        require(signature.getString("algorithm") == "Ed25519") { "更新签名算法不受支持" }
        require(signature.getString("keyId") == KEY_ID) { "更新签名密钥不匹配" }
        require(signed.getString("tag") == expectedTag) { "更新清单与 GitHub Release 不一致" }

        val publicKey = KeyFactory.getInstance("Ed25519").generatePublic(
            X509EncodedKeySpec(Base64.getDecoder().decode(PUBLIC_KEY_BASE64))
        )
        val verifier = Signature.getInstance("Ed25519")
        verifier.initVerify(publicKey)
        verifier.update(payload)
        require(verifier.verify(Base64.getDecoder().decode(signature.getString("value")))) {
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
            android = VerifiedAndroidReleaseAsset(name, size, sha256, certificate)
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
        val archive = if (Build.VERSION.SDK_INT >= 33) {
            context.packageManager.getPackageArchiveInfo(
                apk.absolutePath,
                PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
        } ?: throw IllegalStateException("无法读取 Android 安装包签名")
        val installed = if (Build.VERSION.SDK_INT >= 33) {
            context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        }
        val archiveSigners = archive.signingInfo?.apkContentsSigners.orEmpty().map { sha256(it.toByteArray()) }.toSet()
        val installedSigners = installed.signingInfo?.apkContentsSigners.orEmpty().map { sha256(it.toByteArray()) }.toSet()
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

    private val SHA256 = Regex("[a-f0-9]{64}")
}
