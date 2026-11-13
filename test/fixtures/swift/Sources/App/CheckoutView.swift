import ConfigDirector
import SwiftUI

struct Theme: Decodable, Sendable {
    let accentColor: String

    static let fallback = Theme(accentColor: "blue")
}

struct CheckoutView: View {
    var body: some View {
        let (showBanner, evaluation) = client.evaluate("checkout-banner", default: false)
        let (theme, _) = client.evaluate("theme", as: Theme.self, default: .fallback)
        Text(showBanner ? "Free shipping today" : evaluation.reason.rawValue)
            .foregroundStyle(Color(theme.accentColor))
    }
}
