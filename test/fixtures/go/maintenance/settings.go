package main

import "example.com/app/settings"

var maintenanceMode = settings.Store.BoolValue("maintenance-mode", false, nil)
