import ConfigDirectorTesting
import XCTest

final class DarkModeTests: XCTestCase {
    func testDarkMode() async {
        let testClient = makeTestClient(values: ["dark-mode": true, "max-items": 20])
        await testClient.client.initialize()
        testClient.setValue(false, for: "dark-mode")
        testClient.removeValue(for: "max-items")
    }
}
