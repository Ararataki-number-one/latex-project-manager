import java.io.FileInputStream
import java.security.KeyStore

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
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
        versionCode = 7
        versionName = "0.6.0"
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
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    testImplementation("junit:junit:4.13.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
