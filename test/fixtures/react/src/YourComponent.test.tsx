import { act, render } from "@testing-library/react";
import { createTestClient, installTestClient } from "@configdirector/react-web-sdk/testing";

const testClient = createTestClient({ values: { "dark-mode": true } });
const { ConfigDirectorTestProvider } = installTestClient(testClient);

act(() => testClient.setValue("dark-mode", false));
