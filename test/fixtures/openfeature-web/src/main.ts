import { OpenFeature } from "@openfeature/web-sdk";
import { ConfigDirectorProvider } from "@configdirector/openfeature-web-provider";

const provider = new ConfigDirectorProvider("YOUR-CLIENT-SDK-KEY");
await OpenFeature.setProviderAndWait(provider);
const client = OpenFeature.getClient();

const booleanValue = client.getBooleanValue("my-config-key", false);

const stringValue = client.getStringValue("my-string-config-key", "Default");

const limits = client.getObjectDetails("rate-limits", { perMinute: 60 });
