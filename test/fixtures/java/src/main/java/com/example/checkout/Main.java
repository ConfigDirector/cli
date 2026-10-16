package com.example.checkout;

import com.configdirector.ConfigDirector;
import com.configdirector.ConfigDirectorClient;
import com.configdirector.Subscription;
import java.util.Map;

public class Main {
    public static void main(String[] args) {
        // IMPORTANT: Do not commit the server SDK key to your source code, it is a secret value.
        ConfigDirectorClient client = ConfigDirector.client("YOUR-SERVER-SDK-KEY");
        client.initialize();

        // Retrieve config values
        int retries = client.getInteger("max-retries", 3);
        String theme = client.getString("theme", "light");
        boolean newCheckout = client.getBoolean("new-checkout", false);
        Map<String, Object> limits = client.getJsonObject("rate-limits", Map.of("per_minute", 60)); // JSON config

        // Watch for config updates
        Subscription subscription = client.watchBoolean(
            "new-checkout",
            false,
            value -> System.out.println("new-checkout is now " + value));

        // Call close when the subscription is no longer needed
        subscription.close();
    }
}
