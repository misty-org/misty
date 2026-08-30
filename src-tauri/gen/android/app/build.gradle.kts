import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.misty.mobile"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.misty.mobile"
        minSdk = 28
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("playRelease") {
            val keystoreFile = System.getenv("MISTY_ANDROID_KEYSTORE_FILE")
            val keystorePassword = System.getenv("MISTY_ANDROID_KEYSTORE_PASSWORD")
            val keyAlias = System.getenv("MISTY_ANDROID_KEY_ALIAS")
            val keyPassword = System.getenv("MISTY_ANDROID_KEY_PASSWORD")
            val releaseSigningConfigured = listOf(keystoreFile, keystorePassword, keyAlias, keyPassword)
                .all { !it.isNullOrBlank() }
            if (releaseSigningConfigured) {
                storeFile = file(keystoreFile!!)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            val keystoreFile = System.getenv("MISTY_ANDROID_KEYSTORE_FILE")
            val releaseSigningConfigured = listOf(
                keystoreFile,
                System.getenv("MISTY_ANDROID_KEYSTORE_PASSWORD"),
                System.getenv("MISTY_ANDROID_KEY_ALIAS"),
                System.getenv("MISTY_ANDROID_KEY_PASSWORD"),
            ).all { !it.isNullOrBlank() }
            if (!releaseSigningConfigured && gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }) {
                throw GradleException(
                    "Android release signing is not configured. Set MISTY_ANDROID_KEYSTORE_FILE, " +
                        "MISTY_ANDROID_KEYSTORE_PASSWORD, MISTY_ANDROID_KEY_ALIAS, and " +
                        "MISTY_ANDROID_KEY_PASSWORD before building a release APK/AAB."
                )
            }
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("playRelease")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
