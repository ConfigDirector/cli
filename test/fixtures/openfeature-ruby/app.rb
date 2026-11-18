# frozen_string_literal: true

require "configdirector/openfeature"

# The server SDK key is a secret. Do not commit it to your source code.
OpenFeature::SDK.set_provider_and_wait(
  ConfigDirector::OpenFeature::ConfigDirectorProvider.new(ENV.fetch("CONFIGDIRECTOR_SERVER_KEY"))
)
client = OpenFeature::SDK.build_client
user = OpenFeature::SDK::EvaluationContext.new(targeting_key: "user-123", name: "Ada Lovelace")

new_checkout = client.fetch_boolean_value(flag_key: "new-checkout", default_value: false)
theme = client.fetch_string_value flag_key: "theme", default_value: "light", evaluation_context: user
max_items = client.fetch_integer_details(flag_key: "max-items", default_value: 20)
discount = client.fetch_float_value(default_value: 0.1, flag_key: "checkout-discount")
multiplier = client.fetch_number_value(flag_key: "price-multiplier", default_value: 1)
rate_limits = client.fetch_object_value(flag_key: "rate-limits", default_value: { "per_minute" => 60 })
