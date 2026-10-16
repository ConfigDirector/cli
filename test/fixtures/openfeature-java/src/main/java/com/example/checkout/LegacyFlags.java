package com.example.checkout;

class LegacyFlags {
    static boolean darkMode() {
        return LegacyFlagService.instance().getBooleanValue("legacy-dark-mode", false);
    }
}
