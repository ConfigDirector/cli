import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    exclude: [...configDefaults.exclude, "test/integration/**", "test/packed-tarball/**", "test/fixtures/**"],
  },
});
