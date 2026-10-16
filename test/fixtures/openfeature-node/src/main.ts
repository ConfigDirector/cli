import { OpenFeature } from "@openfeature/server-sdk";
import { ConfigDirectorProvider } from "@configdirector/openfeature-server-provider";

const provider = new ConfigDirectorProvider("YOUR-SERVER-SDK-KEY");
await OpenFeature.setProviderAndWait(provider);
const client = OpenFeature.getClient();

const booleanValue = await client.getBooleanValue("my-config-key", false);

const stringValue = await client.getStringValue("my-string-config-key", "Default");

const retries = await client.getNumberValue("max-retries", 3, { targetingKey: "user-123" });
