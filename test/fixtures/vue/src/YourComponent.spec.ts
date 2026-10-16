import { createTestClient } from "@configdirector/vue-sdk/testing";

const testClient = createTestClient({ values: { "dark-mode": true } });
testClient.setValue("dark-mode", false);
