plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

val admobAppId = providers.gradleProperty("subwayRunnerAdmobAppId")
    .orElse("ca-app-pub-3940256099942544~3347511713")

android {
    namespace = "com.subwayrunner.services"
    compileSdk = 36
    defaultConfig {
        minSdk = 24
        manifestPlaceholders["subwayRunnerAdmobAppId"] = admobAppId.get()
        consumerProguardFiles("consumer-rules.pro")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    compileOnly("org.godotengine:godot:4.6.3.stable")
    implementation("com.android.billingclient:billing:8.1.0")
    implementation("com.google.android.gms:play-services-ads:25.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
}

tasks.named("preBuild") {
    doFirst {
        require(Regex("ca-app-pub-[0-9]{16}~[0-9]{10}").matches(admobAppId.get())) {
            "Pass the owner's AdMob App ID with -PsubwayRunnerAdmobAppId=ca-app-pub-...~..."
        }
    }
}

tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        require(!admobAppId.get().contains("3940256099942544")) {
            "Release builds require the owner's AdMob App ID, never the sample publisher."
        }
    }
}
