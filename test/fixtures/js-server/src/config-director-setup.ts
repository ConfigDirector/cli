import { createClient } from "@configdirector/server-sdk";

// IMPORTANT: Do not commit the server SDK key to your source code, it is a secret value.
export const client = createClient("YOUR-SERVER-SDK-KEY");
await client.initialize();
