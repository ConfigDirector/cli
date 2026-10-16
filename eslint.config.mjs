import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const injectedInvocationMessage =
  "Read the Invocation passed to run, so every command sees the arguments, variables and streams the tests give it.";

export default defineConfig([
  { ignores: ["dist/**", "test/fixtures/**"] },
  tseslint.configs.strict,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/main.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-globals": ["error", { name: "process", message: injectedInvocationMessage }],
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "node:process", message: injectedInvocationMessage }] },
      ],
    },
  },
]);
