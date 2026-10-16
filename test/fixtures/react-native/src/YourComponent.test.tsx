import { act } from "@testing-library/react-native";
import { createTestClient } from "@configdirector/react-native-sdk/testing";

const testClient = createTestClient({ values: { "dark-mode": true } });

await act(() => testClient.setValue("dark-mode", false));
