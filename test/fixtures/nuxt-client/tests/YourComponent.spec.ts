import { createTestClient, installTestClient } from "@configdirector/nuxt-sdk/testing";

const testClient = createTestClient({ values: { "dark-mode": true } });
installTestClient(testClient);
testClient.setValue("dark-mode", false);
