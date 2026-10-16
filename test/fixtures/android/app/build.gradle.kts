plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.example.app"
    compileSdk = 36
}

dependencies {
    implementation("com.configdirector:configdirector-android:1.0.0")
    implementation("com.configdirector:configdirector-android-compose:1.0.0")
    testImplementation("com.configdirector:configdirector-android-testing:1.0.0")
}
