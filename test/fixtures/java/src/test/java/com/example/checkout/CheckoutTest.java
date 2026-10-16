package com.example.checkout;

import com.configdirector.testing.BooleanConfigValue;
import com.configdirector.testing.ConfigDirectorTestExtension;
import com.configdirector.testing.ConfigDirectorTesting;
import com.configdirector.testing.IntegerConfigValue;
import com.configdirector.testing.TestClient;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(ConfigDirectorTestExtension.class)
@BooleanConfigValue(key = "new-checkout", value = true)
class CheckoutTest {
    @Test
    @IntegerConfigValue(key = "max-retries", value = 5)
    void retriesWithTheConfiguredLimit(TestClient testClient) {
        testClient.setValue("new-checkout", false);
    }

    @Test
    void readsTheSeededValues() {
        TestClient testClient = ConfigDirectorTesting.createTestClient(Map.of("new-checkout", true, "theme", "dark"));
        testClient.setValue("theme", "light");
    }
}
