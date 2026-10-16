import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    exclude: [...configDefaults.exclude, "test/packed-tarball/**", "test/fixtures/**"],
  },
});
