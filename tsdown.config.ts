import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { configdirector: "src/main.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  dts: false,
  sourcemap: false,
});
