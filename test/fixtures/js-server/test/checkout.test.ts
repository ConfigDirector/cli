import { createTestClient } from "@configdirector/server-sdk/testing";

const testClient = createTestClient({ values: { "new-checkout": true } });

testClient.setValue("new-checkout", false);
testClient.removeValue("new-checkout");
