import ConfigDirector
import SwiftUI

let client = try! ConfigDirectorClient(clientSDKKey: "YOUR-CLIENT-SDK-KEY")

struct ContentView: View {
    var body: some View {
        // Retrieve the current value. The default value decides the type the config
        // is read as, and is returned until the client is ready.
        let darkMode = client.value(for: "my-config-key", default: false)
        Text(darkMode ? "Dark" : "Light")
            .task {
                for await darkMode in client.values(for: "my-config-key", default: false) {
                    print("Value updated: \(darkMode)")
                }
            }
    }
}

struct Limits: Decodable, Sendable {
    let perMinute: Int
}

let limits = client.value(for: "rate-limits", as: Limits.self, default: Limits(perMinute: 60))
