using ConfigDirector.OpenFeature;
using OpenFeature;

await Api.Instance.SetProviderAsync(new ConfigDirectorProvider("YOUR-SERVER-SDK-KEY"));
var client = Api.Instance.GetClient();

var booleanValue = await client.GetBooleanValueAsync("my-config-key", false);

var stringValue = await client.GetStringValueAsync("my-string-config-key", "Default");

var discount = await client.GetDoubleDetailsAsync("checkout-discount", 0.1);
