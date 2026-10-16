package com.example.checkout;

import com.configdirector.openfeature.ConfigDirectorProvider;
import dev.openfeature.sdk.Client;
import dev.openfeature.sdk.OpenFeatureAPI;

public class Flags {
    public static void main(String[] args) {
        OpenFeatureAPI api = OpenFeatureAPI.getInstance();
        api.setProviderAndWait(new ConfigDirectorProvider("YOUR-SERVER-SDK-KEY"));
        Client client = api.getClient();

        boolean booleanValue = client.getBooleanValue("my-config-key", false);

        String stringValue = client.getStringValue("my-string-config-key", "Default");

        long requestBudget = client.getLongValue("request-budget", 1000L);
    }
}
