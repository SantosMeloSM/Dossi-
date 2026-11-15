plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.com.santosmelo.dossie"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.com.santosmelo.dossie"
        minSdk = 30
        targetSdk = 34
        versionCode = 21
        versionName = "2.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }

    // O app web (pasta /web na raiz do repositório) é empacotado como assets.
    sourceSets["main"].assets.srcDirs("../../web")

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Assinatura: configure signingConfigs para publicar. Sem ela, o CI gera um APK de debug.
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    // Reconhecimento de texto com modelo embutido no APK: funciona sem internet.
    implementation("com.google.mlkit:text-recognition:16.0.1")
}
