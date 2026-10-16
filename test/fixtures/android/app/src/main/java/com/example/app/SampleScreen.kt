package com.example.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.configdirector.compose.configValue

@Composable
fun SampleScreen() {
    // Recomposes whenever the evaluated value changes.
    val darkMode = configValue("my-config-key", false)

    Text("my-config-key: $darkMode")
}
