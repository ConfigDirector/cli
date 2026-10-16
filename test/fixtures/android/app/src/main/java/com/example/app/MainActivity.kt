package com.example.app

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.configdirector.ConfigDirectorClient
import com.configdirector.value
import com.configdirector.values
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var client: ConfigDirectorClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        client = ConfigDirectorClient(applicationContext, "YOUR-CLIENT-SDK-KEY")

        // Retrieve the current value. The default value decides the type the config
        // is read as, and is returned until the client is ready.
        val darkMode = client.value("my-config-key", false)

        // Subscribe to value updates. The flow emits the current value right away
        // and then every time the evaluated value changes.
        lifecycleScope.launch {
            client.values("my-config-key", false).collect { darkMode ->
                Log.i("MyApp", "Value updated: $darkMode")
            }
        }
    }
}
