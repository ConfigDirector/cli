import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { copyFixtureRepository } from "./support/repository-files.js";
import { createSandbox } from "./support/sandbox.js";
import { startScanAdminApi } from "./support/scan-admin-api.js";

type InCodeDefaultValue = { type: string; value: unknown };

type ExpectedReference = {
  key: string;
  file: string;
  line: number;
  call: string;
  default?: InCodeDefaultValue;
  getterType?: string;
  test?: boolean;
};

const directReferenceFor =
  (sdk: string) =>
  ({ test = false, ...reference }: ExpectedReference) => ({ kind: "direct", sdk, ...reference, test });

const validateScanOutput = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(new URL("../schema/scan-output.schema.json", import.meta.url), "utf8")),
);

const scanFixture = async (fixtureName: string) => {
  const adminApi = await startScanAdminApi();
  const sandbox = await createSandbox();
  await copyFixtureRepository(sandbox.workingDirectory, fixtureName);
  const invocation = sandbox.invocation({
    commandLineArguments: ["scan", "--project", "web-app", "--token", "cd_flag_token", "--json"],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
  });

  const exitCode = await run(invocation);

  const output = JSON.parse(invocation.stdout.text());
  return { exitCode, output, schemaErrors: validateScanOutput(output) ? null : validateScanOutput.errors };
};

const falseDefault = { type: "boolean", value: false };

describe("scan SDK families", () => {
  it("finds the JavaScript client SDK's reads and watches through the docs' local setup module, and its test client calls", async () => {
    const reference = directReferenceFor("js-client");

    const { exitCode, output, schemaErrors } = await scanFixture("js-client");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "src/main.ts",
        line: 4,
        call: "getValue",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: "src/main.ts",
        line: 8,
        call: "watch",
        default: falseDefault,
      }),
      reference({ key: "my-config-key", file: "src/main.ts", line: 17, call: "unwatch" }),
      reference({
        key: "new-checkout",
        file: "test/checkout.test.ts",
        line: 3,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "new-checkout",
        file: "test/checkout.test.ts",
        line: 6,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "new-checkout",
        file: "test/checkout.test.ts",
        line: 7,
        call: "removeValue",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "test/checkout.test.ts",
        line: 8,
        call: "replaceValues",
        test: true,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the JavaScript server SDK's reads and watches through the docs' local setup module, and its test client calls", async () => {
    const reference = directReferenceFor("js-server");

    const { exitCode, output, schemaErrors } = await scanFixture("js-server");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "src/main.ts",
        line: 4,
        call: "getValue",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: "src/main.ts",
        line: 7,
        call: "watch",
        default: falseDefault,
      }),
      reference({ key: "my-config-key", file: "src/main.ts", line: 13, call: "unwatch" }),
      reference({
        key: "new-checkout",
        file: "test/checkout.test.ts",
        line: 3,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "new-checkout",
        file: "test/checkout.test.ts",
        line: 5,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "new-checkout",
        file: "test/checkout.test.ts",
        line: 6,
        call: "removeValue",
        test: true,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the React SDK's useConfigValue and test client calls", async () => {
    const reference = directReferenceFor("react");

    const { exitCode, output, schemaErrors } = await scanFixture("react");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "dark-mode",
        file: "src/YourComponent.test.tsx",
        line: 4,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "src/YourComponent.test.tsx",
        line: 7,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "my-config-key",
        file: "src/YourComponent.tsx",
        line: 4,
        call: "useConfigValue",
        default: falseDefault,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the React Native SDK's useConfigValue and test client calls", async () => {
    const reference = directReferenceFor("react-native");

    const { exitCode, output, schemaErrors } = await scanFixture("react-native");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "dark-mode",
        file: "src/YourComponent.test.tsx",
        line: 4,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "src/YourComponent.test.tsx",
        line: 6,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "my-config-key",
        file: "src/YourComponent.tsx",
        line: 4,
        call: "useConfigValue",
        default: falseDefault,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Vue SDK's useConfigValue in a single-file component and its test client calls", async () => {
    const reference = directReferenceFor("vue");

    const { exitCode, output, schemaErrors } = await scanFixture("vue");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "dark-mode",
        file: "src/YourComponent.spec.ts",
        line: 3,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "src/YourComponent.spec.ts",
        line: 4,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "my-config-key",
        file: "src/YourComponent.vue",
        line: 4,
        call: "useConfigValue",
        default: falseDefault,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Nuxt client SDK's auto-imported composables without an import, and its test client calls", async () => {
    const reference = directReferenceFor("nuxt-client");

    const { exitCode, output, schemaErrors } = await scanFixture("nuxt-client");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "dark-mode",
        file: "components/DarkModeToggle.vue",
        line: 3,
        call: "getValue",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: "components/YourComponent.vue",
        line: 2,
        call: "useConfigDirectorValue",
        default: falseDefault,
      }),
      reference({
        key: "dark-mode",
        file: "tests/YourComponent.spec.ts",
        line: 3,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "tests/YourComponent.spec.ts",
        line: 5,
        call: "setValue",
        test: true,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Nuxt server SDK's auto-imported client calls in the server directory", async () => {
    const reference = directReferenceFor("nuxt-server");

    const { exitCode, output, schemaErrors } = await scanFixture("nuxt-server");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "server/api/server-resource.get.ts",
        line: 3,
        call: "getValue",
        default: falseDefault,
      }),
      reference({
        key: "new-checkout",
        file: "server/utils/checkout.ts",
        line: 2,
        call: "getValue",
        default: falseDefault,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Next.js client SDK's useConfigValue and test client calls", async () => {
    const reference = directReferenceFor("nextjs-client");

    const { exitCode, output, schemaErrors } = await scanFixture("nextjs-client");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "dark-mode",
        file: "app/YourComponent.test.tsx",
        line: 4,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "app/YourComponent.test.tsx",
        line: 5,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "my-config-key",
        file: "app/YourComponent.tsx",
        line: 6,
        call: "useConfigValue",
        default: falseDefault,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Next.js server SDK's getValue and test client calls", async () => {
    const reference = directReferenceFor("nextjs-server");

    const { exitCode, output, schemaErrors } = await scanFixture("nextjs-server");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "dark-mode",
        file: "app/route.test.ts",
        line: 4,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "app/route.test.ts",
        line: 6,
        call: "getValue",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: "app/route.ts",
        line: 5,
        call: "getValue",
        default: falseDefault,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature web SDK's typed getters", async () => {
    const reference = directReferenceFor("openfeature-web");

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-web");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "src/main.ts",
        line: 8,
        call: "getBooleanValue",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file: "src/main.ts",
        line: 10,
        call: "getStringValue",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "rate-limits",
        file: "src/main.ts",
        line: 12,
        call: "getObjectDetails",
        default: { type: "json", value: "{ perMinute: 60 }" },
        getterType: "json",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature Node.js SDK's typed getters", async () => {
    const reference = directReferenceFor("openfeature-node");

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-node");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "src/main.ts",
        line: 8,
        call: "getBooleanValue",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file: "src/main.ts",
        line: 10,
        call: "getStringValue",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "max-retries",
        file: "src/main.ts",
        line: 12,
        call: "getNumberValue",
        default: { type: "integer", value: 3 },
        getterType: "number",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Flutter SDK's reads, watches and evaluations through the docs' local setup library, and its test client calls", async () => {
    const reference = directReferenceFor("flutter");

    const { exitCode, output, schemaErrors } = await scanFixture("flutter");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "lib/main.dart",
        line: 4,
        call: "getValue",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: "lib/main.dart",
        line: 7,
        call: "watch",
        default: falseDefault,
      }),
      reference({ key: "my-config-key", file: "lib/main.dart", line: 13, call: "unwatch" }),
      reference({
        key: "max-items",
        file: "lib/main.dart",
        line: 15,
        call: "evaluate",
        default: { type: "integer", value: 20 },
      }),
      reference({
        key: "new-checkout",
        file: "test/home_page_test.dart",
        line: 6,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "new-checkout",
        file: "test/home_page_test.dart",
        line: 8,
        call: "getValue",
        default: falseDefault,
      }),
      reference({
        key: "new-checkout",
        file: "test/home_page_test.dart",
        line: 9,
        call: "setValue",
        test: true,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature Flutter SDK's typed getters", async () => {
    const reference = directReferenceFor("openfeature-flutter");

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-flutter");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "lib/main.dart",
        line: 9,
        call: "getBooleanValue",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file: "lib/main.dart",
        line: 11,
        call: "getStringValue",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "rate-limits",
        file: "lib/main.dart",
        line: 13,
        call: "getStructureValue",
        default: { type: "json", value: "{'perMinute': 60}" },
        getterType: "json",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Swift SDK's labelled reads and streams and its test client calls", async () => {
    const reference = directReferenceFor("swift");

    const { exitCode, output, schemaErrors } = await scanFixture("swift");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "Sources/App/ContentView.swift",
        line: 10,
        call: "value",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: "Sources/App/ContentView.swift",
        line: 13,
        call: "values",
        default: falseDefault,
      }),
      reference({ key: "rate-limits", file: "Sources/App/ContentView.swift", line: 24, call: "value" }),
      reference({
        key: "dark-mode",
        file: "Tests/AppTests/DarkModeTests.swift",
        line: 6,
        call: "makeTestClient",
        test: true,
      }),
      reference({
        key: "max-items",
        file: "Tests/AppTests/DarkModeTests.swift",
        line: 6,
        call: "makeTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "Tests/AppTests/DarkModeTests.swift",
        line: 8,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "max-items",
        file: "Tests/AppTests/DarkModeTests.swift",
        line: 9,
        call: "removeValue",
        test: true,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature Swift SDK's labelled typed getters", async () => {
    const reference = directReferenceFor("openfeature-swift");

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-swift");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "Sources/App/FlagViews.swift",
        line: 6,
        call: "getBooleanValue",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file: "Sources/App/FlagViews.swift",
        line: 8,
        call: "getStringValue",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "max-items",
        file: "Sources/App/FlagViews.swift",
        line: 10,
        call: "getIntegerValue",
        default: { type: "integer", value: 20 },
        getterType: "integer",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Android SDK's Kotlin reads, Java getters and watches, Compose reads and test client calls", async () => {
    const reference = directReferenceFor("android");
    const sources = "app/src/main/java/com/example/app";

    const { exitCode, output, schemaErrors } = await scanFixture("android");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: `${sources}/MainActivity.kt`,
        line: 21,
        call: "value",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: `${sources}/MainActivity.kt`,
        line: 26,
        call: "values",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: `${sources}/SampleScreen.kt`,
        line: 10,
        call: "configValue",
        default: falseDefault,
      }),
      reference({
        key: "my-config-key",
        file: `${sources}/SettingsActivity.java`,
        line: 17,
        call: "getBoolean",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-config-key",
        file: `${sources}/SettingsActivity.java`,
        line: 22,
        call: "watchBoolean",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "dark-mode",
        file: "app/src/test/java/com/example/app/DarkModeTest.kt",
        line: 10,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "max-items",
        file: "app/src/test/java/com/example/app/DarkModeTest.kt",
        line: 10,
        call: "createTestClient",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "app/src/test/java/com/example/app/DarkModeTest.kt",
        line: 11,
        call: "setValue",
        test: true,
      }),
      reference({
        key: "dark-mode",
        file: "app/src/test/java/com/example/app/DarkModeTest.kt",
        line: 12,
        call: "value",
        default: { type: "boolean", value: true },
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature Android SDK's typed getters", async () => {
    const reference = directReferenceFor("openfeature-android");
    const file = "app/src/main/java/com/example/app/Flags.kt";

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-android");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file,
        line: 13,
        call: "getBooleanValue",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file,
        line: 15,
        call: "getStringValue",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "max-items",
        file,
        line: 17,
        call: "getIntegerDetails",
        default: { type: "integer", value: 20 },
        getterType: "integer",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Java server SDK's typed getters, watches, test client calls and test annotations", async () => {
    const reference = directReferenceFor("java");
    const main = "src/main/java/com/example/checkout/Main.java";
    const test = "src/test/java/com/example/checkout/CheckoutTest.java";

    const { exitCode, output, schemaErrors } = await scanFixture("java");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "max-retries",
        file: main,
        line: 15,
        call: "getInteger",
        default: { type: "integer", value: 3 },
        getterType: "integer",
      }),
      reference({
        key: "theme",
        file: main,
        line: 16,
        call: "getString",
        default: { type: "string", value: "light" },
        getterType: "string",
      }),
      reference({
        key: "new-checkout",
        file: main,
        line: 17,
        call: "getBoolean",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({ key: "rate-limits", file: main, line: 18, call: "getJsonObject", getterType: "json" }),
      reference({
        key: "new-checkout",
        file: main,
        line: 22,
        call: "watchBoolean",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({ key: "new-checkout", file: test, line: 13, call: "BooleanConfigValue", test: true }),
      reference({ key: "max-retries", file: test, line: 16, call: "IntegerConfigValue", test: true }),
      reference({ key: "new-checkout", file: test, line: 18, call: "setValue", test: true }),
      reference({ key: "new-checkout", file: test, line: 23, call: "createTestClient", test: true }),
      reference({ key: "theme", file: test, line: 23, call: "createTestClient", test: true }),
      reference({ key: "theme", file: test, line: 24, call: "setValue", test: true }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature Java SDK's typed getters", async () => {
    const reference = directReferenceFor("openfeature-java");
    const file = "src/main/java/com/example/checkout/Flags.java";

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-java");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file,
        line: 13,
        call: "getBooleanValue",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file,
        line: 15,
        call: "getStringValue",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "request-budget",
        file,
        line: 17,
        call: "getLongValue",
        default: { type: "integer", value: 1000 },
        getterType: "integer",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Python SDK's reads with positional and keyword arguments and watches through a local setup module, and its test client calls", async () => {
    const reference = directReferenceFor("python");
    const main = "app/main.py";
    const test = "tests/test_checkout.py";

    const { exitCode, output, schemaErrors } = await scanFixture("python");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "max-retries",
        file: main,
        line: 4,
        call: "get_value",
        default: { type: "integer", value: 3 },
      }),
      reference({
        key: "theme",
        file: main,
        line: 5,
        call: "get_value",
        default: { type: "string", value: "light" },
      }),
      reference({
        key: "rate-limits",
        file: main,
        line: 6,
        call: "get_value",
        default: { type: "json", value: '{"per_minute": 60}' },
      }),
      reference({ key: "new-checkout", file: main, line: 12, call: "watch", default: falseDefault }),
      reference({
        key: "request-timeout",
        file: main,
        line: 17,
        call: "get_value",
        default: { type: "float", value: 2.5 },
      }),
      reference({ key: "new-checkout", file: test, line: 5, call: "create_test_client", test: true }),
      reference({ key: "new-checkout", file: test, line: 6, call: "set_value", test: true }),
      reference({
        key: "new-checkout",
        file: test,
        line: 7,
        call: "get_value",
        default: { type: "boolean", value: true },
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature Python SDK's typed getters, including the async ones", async () => {
    const reference = directReferenceFor("openfeature-python");

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-python");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "app/flags.py",
        line: 7,
        call: "get_boolean_value",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file: "app/flags.py",
        line: 9,
        call: "get_string_value",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "sample-ratio",
        file: "app/flags.py",
        line: 13,
        call: "get_float_value_async",
        default: { type: "float", value: 0.25 },
        getterType: "float",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the .NET SDK's reads, watches and test client calls", async () => {
    const reference = directReferenceFor("dotnet");

    const { exitCode, output, schemaErrors } = await scanFixture("dotnet");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "max-retries",
        file: "Program.cs",
        line: 11,
        call: "GetValue",
        default: { type: "integer", value: 3 },
      }),
      reference({
        key: "theme",
        file: "Program.cs",
        line: 12,
        call: "GetValue",
        default: { type: "string", value: "light" },
      }),
      reference({
        key: "new-checkout",
        file: "Program.cs",
        line: 13,
        call: "GetValue",
        default: falseDefault,
      }),
      reference({ key: "rate-limits", file: "Program.cs", line: 14, call: "GetValue" }),
      reference({ key: "new-checkout", file: "Program.cs", line: 18, call: "Watch", default: falseDefault }),
      reference({
        key: "new-checkout",
        file: "Tests/CheckoutTests.cs",
        line: 10,
        call: "CreateTestClient",
        test: true,
      }),
      reference({
        key: "new-checkout",
        file: "Tests/CheckoutTests.cs",
        line: 11,
        call: "SetValue",
        test: true,
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature .NET SDK's typed async getters", async () => {
    const reference = directReferenceFor("openfeature-dotnet");

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-dotnet");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "Flags.cs",
        line: 7,
        call: "GetBooleanValueAsync",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file: "Flags.cs",
        line: 9,
        call: "GetStringValueAsync",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "checkout-discount",
        file: "Flags.cs",
        line: 11,
        call: "GetDoubleDetailsAsync",
        default: { type: "float", value: 0.1 },
        getterType: "float",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Go SDK's typed reads, JSON reads, watches and test client calls", async () => {
    const reference = directReferenceFor("go");

    const { exitCode, output, schemaErrors } = await scanFixture("go");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "max-retries",
        file: "main.go",
        line: 26,
        call: "IntValue",
        default: { type: "integer", value: 3 },
        getterType: "integer",
      }),
      reference({
        key: "theme",
        file: "main.go",
        line: 27,
        call: "StringValue",
        default: { type: "string", value: "light" },
        getterType: "string",
      }),
      reference({
        key: "new-checkout",
        file: "main.go",
        line: 28,
        call: "BoolValue",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({ key: "rate-limits", file: "main.go", line: 32, call: "JSONValue", getterType: "json" }),
      reference({
        key: "new-checkout",
        file: "main.go",
        line: 37,
        call: "WatchBool",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({ key: "new-checkout", file: "main_test.go", line: 10, call: "NewTestClient", test: true }),
      reference({ key: "new-checkout", file: "main_test.go", line: 12, call: "SetValue", test: true }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the OpenFeature Go SDK's typed getters, whose key follows the context", async () => {
    const reference = directReferenceFor("openfeature-go");

    const { exitCode, output, schemaErrors } = await scanFixture("openfeature-go");

    expect(exitCode).toEqual(0);
    expect(schemaErrors).toEqual(null);
    expect(output.references).toEqual([
      reference({
        key: "my-config-key",
        file: "main.go",
        line: 26,
        call: "Boolean",
        default: falseDefault,
        getterType: "boolean",
      }),
      reference({
        key: "my-string-config-key",
        file: "main.go",
        line: 28,
        call: "String",
        default: { type: "string", value: "Default" },
        getterType: "string",
      }),
      reference({
        key: "max-items",
        file: "main.go",
        line: 30,
        call: "Int",
        default: { type: "integer", value: 20 },
        getterType: "integer",
      }),
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });
});
