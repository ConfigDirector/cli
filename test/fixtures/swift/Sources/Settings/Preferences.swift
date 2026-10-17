import Foundation

let theme = UserDefaults.standard.value(forKey: "theme-preference")
let cachedTheme = settingsCache.value(for: "cached-theme", default: "light")
