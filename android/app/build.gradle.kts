import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

val gamesId = providers.gradleProperty("playGamesAppId")
    .orElse(providers.environmentVariable("PLAY_GAMES_APP_ID")).orElse("")
val adsMode = providers.gradleProperty("adsMode").orElse("test")
val production = providers.gradleProperty("production").orElse("false")
val requireSigning = providers.gradleProperty("requireSigning").orElse("false")
val appVersionCode = providers.gradleProperty("versionCode")
    .orElse(providers.environmentVariable("ANDROID_VERSION_CODE")).orElse("100").get().toInt()
val signingNames = listOf("ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
val signingValues = signingNames.associateWith { providers.environmentVariable(it).orNull }
val ownerSigningPresent = signingValues.values.all { !it.isNullOrBlank() }

android {
    namespace = "com.subwayrunner.bd"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "com.subwayrunner.bd"
        minSdk = 24
        targetSdk = 36
        versionCode = appVersionCode
        versionName = "1.0.0-internal"
        resValue("string", "play_games_app_id", gamesId.get())
        buildConfigField("String", "SERVER_CLIENT_ID", "\"613238310945-2i9sn4s6j2458pcbb87atclvkul2h79s.apps.googleusercontent.com\"")
        buildConfigField("String", "BACKEND_URL", "\"https://subway-runner-api.abirahomod12113.workers.dev\"")
        buildConfigField("String", "PRIVACY_URL", "\"https://broken-mountain-7eb6.abirahomod12113.workers.dev/\"")
        buildConfigField("String", "DELETION_URL", "\"https://broken-mountain-7eb6.abirahomod12113.workers.dev/delete-account.html\"")
        buildConfigField("boolean", "TEST_ADS", (adsMode.get() != "live").toString())
        manifestPlaceholders["admobAppId"] = if (adsMode.get() == "live")
            "ca-app-pub-1379059201302335~7903669960" else "ca-app-pub-3940256099942544~3347511713"
    }
    if (ownerSigningPresent) {
        signingConfigs.create("ownerUpload") {
            storeFile = file(signingValues.getValue("ANDROID_KEYSTORE_PATH")!!)
            storePassword = signingValues.getValue("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = signingValues.getValue("ANDROID_KEY_ALIAS")
            keyPassword = signingValues.getValue("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        debug {
            isDebuggable = true
            // Debug always uses official Google samples, even with -PadsMode=live.
            buildConfigField("boolean", "TEST_ADS", "true")
            manifestPlaceholders["admobAppId"] = "ca-app-pub-3940256099942544~3347511713"
        }
        release {
            isDebuggable = false
            isMinifyEnabled = false
            if (ownerSigningPresent) signingConfig = signingConfigs.getByName("ownerUpload")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    sourceSets.getByName("main").assets.srcDir("../../web")
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Kotlin 2.4+: configure JVM bytecode target using compilerOptions.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation(platform("com.google.firebase:firebase-bom:35.1.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.android.gms:play-services-games-v2:22.1.0")
    implementation("com.android.billingclient:billing:9.1.0")
    implementation("com.google.android.gms:play-services-ads:25.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
}

tasks.register("validateProductionConfiguration") {
    doLast {
        require(adsMode.get() in listOf("test", "live")) { "adsMode must be test or live" }
        require(gamesId.get().isEmpty() || gamesId.get().matches(Regex("[0-9]+"))) {
            "Use the actual Play Games app_id resource, explicitly obtained from Play Games configuration"
        }
        require(appVersionCode in 1..2100000000) { "ANDROID_VERSION_CODE must be an Android/Play-compatible positive integer" }
        if (requireSigning.get().toBoolean()) {
            require(ownerSigningPresent) { "This workflow requires the existing authorized owner upload signing configuration" }
            val uploadKey = File(signingValues.getValue("ANDROID_KEYSTORE_PATH")!!)
            require(uploadKey.isAbsolute && uploadKey.isFile && uploadKey.canRead()) { "Upload keystore must be an absolute readable private file" }
        }
        if (production.get().toBoolean()) {
            require(gamesId.get().isNotEmpty()) { "PLAY_GAMES_APP_ID is missing; Cloud/Firebase project number is not assumed to be the game ID" }
            require(ownerSigningPresent) { "Owner-authorized upload signing credentials are required for production" }
            require(adsMode.get() == "live") { "Production requires explicit -PadsMode=live after rewarded SSV testing" }
        }
    }
}
tasks.named("preBuild").configure { dependsOn("validateProductionConfiguration") }
