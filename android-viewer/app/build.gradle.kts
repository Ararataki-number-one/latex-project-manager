import java.io.FileInputStream
import java.security.KeyStore

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

fun firstPrivateKeyAlias(path: String, password: String): String {
    val store = KeyStore.getInstance("PKCS12")
    FileInputStream(path).use { store.load(it, password.toCharArray()) }
    return store.aliases().toList().firstOrNull { store.isKeyEntry(it) }
        ?: error("Android signing store does not contain a private key")
}

android {
    namespace = "com.zqy.latexviewer"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zqy.latexviewer"
        minSdk = 26
        targetSdk = 36
        versionCode = 14
        versionName = "0.11.0"

        val githubClientId = providers.gradleProperty("githubOAuthClientId")
            .orElse(providers.environmentVariable("GITHUB_OAUTH_CLIENT_ID"))
            .orElse("")
            .get()
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
        buildConfigField("String", "GITHUB_OAUTH_CLIENT_ID", "\"$githubClientId\"")
    }

    val releaseStorePath = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
    val releaseStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")?.takeIf { it.isNotBlank() }
    val releaseSigning = if (releaseStorePath != null && releaseStorePassword != null) {
        signingConfigs.create("release") {
            storeFile = file(releaseStorePath)
            storePassword = releaseStorePassword
            keyAlias = firstPrivateKeyAlias(releaseStorePath, releaseStorePassword)
            keyPassword = releaseStorePassword
            storeType = "PKCS12"
        }
    } else null

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            releaseSigning?.let { signingConfig = it }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.00")
    implementation(composeBom)

    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("androidx.room:room-runtime:2.8.4")
    implementation("androidx.room:room-ktx:2.8.4")
    ksp("androidx.room:room-compiler:2.8.4")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("dev.chrisbanes.haze:haze:1.7.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    // 2.0.3 declares minCompileSdk 37, which is not yet available on the
    // stable Android SDK channel used by GitHub Actions. 2.0.2 exposes the
    // same v2 API used by the reader while remaining compatible with API 36.
    implementation("io.legere:pdfiumandroid:2.0.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.room:room-testing:2.8.4")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
