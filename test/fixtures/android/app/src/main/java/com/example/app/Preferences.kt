package com.example.app

import android.content.SharedPreferences

fun prefersDarkMode(preferences: SharedPreferences) = preferences.getBoolean("dark-mode", false)
