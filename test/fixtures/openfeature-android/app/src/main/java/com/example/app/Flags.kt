package com.example.app

import android.content.Context
import com.configdirector.openfeature.ConfigDirectorProvider
import dev.openfeature.kotlin.sdk.ImmutableContext
import dev.openfeature.kotlin.sdk.OpenFeatureAPI

suspend fun readFlags(applicationContext: Context) {
    val provider = ConfigDirectorProvider(applicationContext, "YOUR-CLIENT-SDK-KEY")
    OpenFeatureAPI.setProviderAndWait(provider, ImmutableContext(targetingKey = "user-123"))
    val client = OpenFeatureAPI.getClient()

    val booleanValue = client.getBooleanValue("my-config-key", false)

    val stringValue = client.getStringValue("my-string-config-key", "Default")

    val maxItems = client.getIntegerDetails("max-items", 20)
}
