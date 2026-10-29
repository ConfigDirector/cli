import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.spec.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
