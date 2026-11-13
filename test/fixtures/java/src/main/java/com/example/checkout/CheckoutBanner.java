package com.example.checkout;

import com.configdirector.ConfigDirectorClient;
import com.configdirector.ConfigEvaluation;
import com.configdirector.Context;

class CheckoutBanner {
    static boolean shown(ConfigDirectorClient client, Context context) {
        ConfigEvaluation evaluation = client.evaluate("checkout-banner", false, context);
        return (Boolean) evaluation.value();
    }

    static Object pageSize(ConfigDirectorClient client) {
        return client.evaluate("page-size", 20).value();
    }
}
