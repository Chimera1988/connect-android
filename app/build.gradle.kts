plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}
android {
    namespace = "com.connect.messenger"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.connect.messenger"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "1.3.3"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("com.google.firebase:firebase-messaging:24.1.2")
    implementation("androidx.core:core:1.15.0")
}
