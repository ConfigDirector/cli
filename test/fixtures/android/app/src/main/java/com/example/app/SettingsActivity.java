package com.example.app;

import android.util.Log;
import com.configdirector.ConfigDirectorClient;
import com.configdirector.Subscription;

public class SettingsActivity {
    private final ConfigDirectorClient client;

    SettingsActivity(ConfigDirectorClient client) {
        this.client = client;
    }

    void showSettings() {
        // Retrieve the current value. There is a getter per type a config can be read
        // as, and each returns the default value until the client is ready.
        boolean darkMode = client.getBoolean("my-config-key", false);

        // Subscribe to value updates. The listener is called on the main thread with the
        // current value, and then every time the evaluated value changes.
        Subscription subscription = client.watchBoolean(
            "my-config-key",
            false,
            value -> Log.i("MyApp", "Value updated: " + value));

        // Close the subscription to stop watching
        subscription.close();
    }
}
