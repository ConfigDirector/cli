import { getConfigClient } from "@configdirector/nextjs-sdk/server";
import { createTestClient, installServerTestClient } from "@configdirector/nextjs-sdk/server/testing";

const testClient = createTestClient({ values: { "dark-mode": true } });
installServerTestClient(testClient);
getConfigClient().getValue("dark-mode", false, { id: "user-1" });
