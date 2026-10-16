import { createClient } from "@configdirector/client-sdk";

export const client = createClient("YOUR-CLIENT-SDK-KEY");
await client.initialize();
