using System.Text.Json;
using ConfigDirector;

// IMPORTANT: Do not commit the server SDK key to your source code, it is a secret value.
// Building the client makes no network calls.
await using var client = new ConfigDirectorClient("YOUR-SERVER-SDK-KEY");

await client.InitializeAsync();

// Retrieve config values
var retries = client.GetValue("max-retries", 3);
var theme = client.GetValue("theme", "light");
var newCheckout = client.GetValue("new-checkout", false);
var limits = client.GetValue("rate-limits", default(JsonElement)); // JSON config

// Watch for config updates
var subscription = client.Watch(
    "new-checkout",
    false,
    value => Console.WriteLine($"new-checkout is now {value}"));

// Dispose the subscription when it is no longer needed
subscription.Dispose();
