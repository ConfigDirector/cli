package com.example.checkout;

public class Settings {
    static boolean verbose() {
        return Boolean.getBoolean("checkout.verbose");
    }
}
