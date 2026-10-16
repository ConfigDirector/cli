package com.example.app

import com.configdirector.testing.createTestClient
import com.configdirector.value
import org.junit.Test

class DarkModeTest {
    @Test
    fun darkModeCanBeTurnedOff() {
        val testClient = createTestClient(values = mapOf("dark-mode" to true, "max-items" to 20))
        testClient.setValue("dark-mode", false)
        assert(!testClient.client.value("dark-mode", true))
    }
}
