package main

import "example.com/app/legacyflags"

var legacyDarkMode = legacyflags.Client.Boolean(nil, "legacy-dark-mode", false, nil)
