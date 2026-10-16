import { createTestClient } from "@configdirector/client-sdk/testing";

const testClient = createTestClient({ values: { "new-checkout": true } });
await testClient.client.initialize();

testClient.setValue("new-checkout", false);
testClient.removeValue("new-checkout");
testClient.replaceValues({ "dark-mode": true });
