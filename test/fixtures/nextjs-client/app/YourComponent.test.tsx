import { act } from "@testing-library/react";
import { createTestClient } from "@configdirector/nextjs-sdk/client/testing";

const testClient = createTestClient({ values: { "dark-mode": true } });
act(() => testClient.setValue("dark-mode", false));
