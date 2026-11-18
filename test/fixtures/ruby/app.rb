# frozen_string_literal: true

require "configdirector"

# The server SDK key is a secret. Do not commit it to your source code.
client = ConfigDirector.create_client(
  ENV.fetch("CONFIGDIRECTOR_SERVER_KEY"),
  metadata: ConfigDirector::Metadata.new(app_name: "my-awesome-app", app_version: "1.0.0")
)

# Watch for config updates
subscription = client.watch("max-items", 20) do |max_items|
  puts "max-items is now #{max_items}"
end

client.init

context = ConfigDirector::Context.new(id: "user-123", name: "Ada Lovelace")

# Retrieve config values
new_checkout = client.get_value("new-checkout", false, context)
theme = client.get_value "theme", "light", context
rate_limits = client.get_value("rate-limits", { "per_minute" => 60 }, context)
evaluation = client.evaluate "checkout-button-color", "blue",
                             context

subscription.close
client.unwatch "max-items"
