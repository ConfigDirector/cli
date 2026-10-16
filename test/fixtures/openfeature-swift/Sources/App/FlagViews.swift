import ConfigDirectorOpenFeatureProvider
import OpenFeature

let client = OpenFeatureAPI.shared.getClient()

let booleanValue = client.getBooleanValue(key: "my-config-key", defaultValue: false)

let stringValue = client.getStringValue(key: "my-string-config-key", defaultValue: "Default")

let maxItems = client.getIntegerValue(key: "max-items", defaultValue: 20)
