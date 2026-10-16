import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/packed-tarball/**/*.spec.ts"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
