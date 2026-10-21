import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { projectConfig, startScanAdminApi, webApp } from "./support/scan-admin-api.js";

const serverSdkFile = (lines: string[]) =>
  [
    'import { createClient } from "@configdirector/server-sdk";',
    "",
    'const client = createClient("YOUR-SERVER-SDK-KEY");',
    ...lines,
    "",
  ].join("\n");

const serverSdkCall = (key: string) => serverSdkFile([`client.getValue("${key}", false);`]);

const referencedKeysAndFiles = (output: { references: Array<{ key: string; file: string }> }) =>
  output.references.map((reference) => [reference.key, reference.file]);

const referencedKeysFilesAndSdks = (output: {
  references: Array<{ key: string; file: string; sdk: string }>;
}) => output.references.map((reference) => [reference.key, reference.file, reference.sdk]);

const scanOutputSchemaValidator = async () => {
  const schema = JSON.parse(
    await readFile(new URL("../schema/scan-output.schema.json", import.meta.url), "utf8"),
  );
  return new Ajv2020({ allErrors: true }).compile(schema);
};

const scan = async (sandbox: Sandbox, baseUrl: string, commandLineArguments: string[] = []) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "scan",
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
      ...commandLineArguments,
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });
  const exitCode = await run(invocation);
  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const scanJson = async (sandbox: Sandbox, baseUrl: string, commandLineArguments: string[] = []) => {
  const { exitCode, stdout, stderr } = await scan(sandbox, baseUrl, ["--json", ...commandLineArguments]);
  return { exitCode, stderr, output: stdout === "" ? undefined : JSON.parse(stdout) };
};

const scanServerSdkCalls = async (lines: string[]) => {
  const adminApi = await startScanAdminApi();
  const sandbox = await createSandbox();
  await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkFile(lines));
  return scanJson(sandbox, adminApi.baseUrl, ["--no-snippets"]);
};

describe("scan", () => {
  it("reports an SDK call whose key is a string literal as a direct reference with its in-code default value", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        'export const newCheckout = () => client.getValue("new-checkout", false);',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, ["--no-snippets"]);

    expect(exitCode).toEqual(0);
    expect(output).toEqual({
      project: "web-app",
      filesScanned: 1,
      references: [
        {
          key: "new-checkout",
          file: "src/checkout.ts",
          line: 4,
          kind: "direct",
          sdk: "js-server",
          call: "getValue",
          default: { type: "boolean", value: false },
          test: false,
        },
      ],
      dynamicReferences: [],
    });
  });

  it("reports an SDK call whose key is not a string literal as a dynamic reference with the argument as written", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/settings.ts",
      [
        'import type { ConfigDirectorClient } from "@configdirector/server-sdk";',
        "",
        "export const settingValues = (client: ConfigDirectorClient, settings: { key: string }[]) =>",
        "  settings.map((setting) => client.getValue(setting.key, false));",
        "export const regionalBanner = (client: ConfigDirectorClient, region: string) =>",
        "  client.getValue(`banner-${region}`, false);",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([
      { file: "src/settings.ts", line: 4, sdk: "js-server", call: "getValue", argument: "setting.key" },
      {
        file: "src/settings.ts",
        line: 6,
        sdk: "js-server",
        call: "getValue",
        argument: "`banner-${region}`",
      },
    ]);
  });

  it("reports nothing for a string literal key shorter than 4 characters", async () => {
    const { exitCode, output } = await scanServerSdkCalls(['client.getValue("abc", false);']);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reports nothing for a string literal key containing a space", async () => {
    const { exitCode, output } = await scanServerSdkCalls(['client.getValue("new checkout", false);']);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reports nothing for a string literal key that starts with a dash", async () => {
    const { exitCode, output } = await scanServerSdkCalls(['client.getValue("-new-checkout", false);']);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reports nothing for a string literal key longer than 150 characters", async () => {
    const { exitCode, output } = await scanServerSdkCalls([`client.getValue("${"k".repeat(151)}", false);`]);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reports a string literal key of exactly 150 characters", async () => {
    const { exitCode, output } = await scanServerSdkCalls([`client.getValue("${"k".repeat(150)}", false);`]);

    expect(exitCode).toEqual(0);
    expect(output.references.map((reference: { key: string }) => reference.key)).toEqual(["k".repeat(150)]);
  });

  it("skips the SDK calls of a file that does not contain the SDK's import marker", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/signup-form.ts",
      [
        'import { useForm } from "react-hook-form";',
        "",
        "const form = useForm();",
        'export const email = () => form.getValue("email-address", "");',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.filesScanned).toEqual(1);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reports the SDK call inside a wrapper function but not the wrapper's own definition", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/flags.js",
      [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        "export function getValue(flagKey, fallback) {",
        "  return client.getValue(flagKey, fallback);",
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.dynamicReferences).toEqual([
      { file: "src/flags.js", line: 5, sdk: "js-server", call: "getValue", argument: "flagKey" },
    ]);
  });

  it("reports nothing for SDK calls inside comments and strings", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        '// client.getValue("old-checkout", false);',
        '/* client.getValue("older-checkout", false); */',
        'const hint = "call client.getValue(\\"hint-checkout\\", false) to read it";',
        'client.getValue("new-checkout", false);',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reports a test client seeded from a variable as a dynamic reference", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "test/checkout.test.ts",
      [
        'import { createTestClient } from "@configdirector/server-sdk/testing";',
        'import { seededValues } from "./seeded-values";',
        "",
        "const testClient = createTestClient({ values: seededValues });",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([
      {
        file: "test/checkout.test.ts",
        line: 4,
        sdk: "js-server",
        call: "createTestClient",
        argument: "seededValues",
      },
    ]);
  });

  it("reports an integer literal in-code default value", async () => {
    const { exitCode, output } = await scanServerSdkCalls(['client.getValue("max-retries", 3);']);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual({ type: "integer", value: 3 });
  });

  it("reports a negative float literal in-code default value", async () => {
    const { exitCode, output } = await scanServerSdkCalls(['client.getValue("retry-backoff", -2.5);']);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual({ type: "float", value: -2.5 });
  });

  it("reports a string literal in-code default value", async () => {
    const { exitCode, output } = await scanServerSdkCalls(["client.getValue('theme', 'light');"]);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual({ type: "string", value: "light" });
  });

  it("reports an object literal in-code default value as JSON written as in the code", async () => {
    const { exitCode, output } = await scanServerSdkCalls([
      'client.getValue("rate-limits", { perMinute: 60 });',
    ]);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual({ type: "json", value: "{ perMinute: 60 }" });
  });

  it("reports an array literal in-code default value as JSON written as in the code", async () => {
    const { exitCode, output } = await scanServerSdkCalls([
      'client.getValue("allowed-regions", ["eu", "us"]);',
    ]);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual({ type: "json", value: '["eu", "us"]' });
  });

  it("reports no in-code default value when the call passes one that is not a literal", async () => {
    const { exitCode, output } = await scanServerSdkCalls([
      'client.getValue("fallback-theme", defaultTheme);',
    ]);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([
      {
        key: "fallback-theme",
        file: "src/checkout.ts",
        line: 4,
        kind: "direct",
        sdk: "js-server",
        call: "getValue",
        test: false,
      },
    ]);
  });

  it("reports no in-code default value for a number literal too large to hold", async () => {
    const { exitCode, output } = await scanServerSdkCalls(['client.getValue("request-budget", 1e400);']);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual(undefined);
  });
});

describe("scan local imports", () => {
  const clientSetup = [
    'import { createClient } from "@configdirector/client-sdk";',
    "",
    'export const client = createClient("YOUR-CLIENT-SDK-KEY");',
    "await client.initialize();",
    "",
  ].join("\n");

  const callsThroughLocalClient = (specifier: string) =>
    [`import { client } from "${specifier}";`, "", 'client.getValue("new-checkout", false);', ""].join("\n");

  const swiftPackageManifest = [
    "// swift-tools-version: 5.9",
    "import PackageDescription",
    "",
    "let package = Package(",
    '    name: "Shop",',
    "    dependencies: [",
    '        .package(url: "https://github.com/ConfigDirector/configdirector-swift-sdk", from: "1.8.0"),',
    "    ],",
    "    targets: [",
    "        .target(",
    '            name: "Shop",',
    '            dependencies: [.product(name: "ConfigDirector", package: "configdirector-swift-sdk")]',
    "        ),",
    "    ]",
    ")",
    "",
  ].join("\n");

  const swiftClientSetup = [
    "import ConfigDirector",
    "",
    'let client = try ConfigDirectorClient(clientSDKKey: "YOUR-CLIENT-SDK-KEY")',
    "",
    "await client.initialize()",
    "",
  ].join("\n");

  const xcodeProjectFile = "// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n}\n";

  const goPackageDeclaringClient = [
    "package shop",
    "",
    'import "github.com/ConfigDirector/go-sdks/configdirector"',
    "",
    "var Client *configdirector.Client",
    "",
  ].join("\n");

  const swiftCallThroughClientOfTarget = [
    "import SwiftUI",
    "",
    "struct ContentView: View {",
    '    let newCheckout = client.value(for: "new-checkout", default: false)',
    "}",
    "",
  ].join("\n");

  it("finds the SDK calls of a file that imports the client from a local setup module, as the docs show", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/config-director-setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main.ts",
      [
        'import { client } from "./config-director-setup"',
        "",
        "// Retrieve the current value",
        'const value = client.getValue("my-config-key", false);',
        "",
        "// Subscribe to value updates",
        "const unwatchMyKey = client.watch(",
        '  "my-config-key",',
        "  false,",
        "  (newValue) => {",
        '    console.log("Value updated:", newValue)',
        "  },",
        ");",
        "",
        "unwatchMyKey(); // Call the unwatch function returned to remove the listener",
        "",
        'client.unwatch("my-config-key"); // Removes all listeners for that key',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(
      output.references.map((reference: { file: string; line: number; call: string; sdk: string }) => [
        reference.file,
        reference.line,
        reference.call,
        reference.sdk,
      ]),
    ).toEqual([
      ["src/main.ts", 4, "getValue", "js-client"],
      ["src/main.ts", 8, "watch", "js-client"],
      ["src/main.ts", 17, "unwatch", "js-client"],
    ]);
  });

  it("follows a local import written with a .js extension to its TypeScript file", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/config-director-setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("./config-director-setup.js"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a local import of a directory to its index file", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/flags/index.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout/page.ts",
      callsThroughLocalClient("../flags"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/checkout/page.ts", "js-client"],
    ]);
  });

  it("follows a local import to a module that re-exports the client from another", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director-setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/index.ts",
      'export { client } from "./config-director-setup";\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", callsThroughLocalClient("./lib"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows two re-export steps from the imported module to the client setup", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/flags/setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/flags/index.ts",
      'export { client } from "./setup";\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/index.ts",
      'export { client } from "./flags";\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", callsThroughLocalClient("./lib"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a re-export of everything a module exports", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director-setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/index.ts",
      'export * from "./config-director-setup";\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", callsThroughLocalClient("./lib"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a re-export of a module as a namespace", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director-setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/index.ts",
      'export * as flags from "./config-director-setup";\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      ['import { flags } from "./lib";', "", 'flags.client.getValue("new-checkout", false);', ""].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("skips a look-alike call in a file whose imported module re-exports no client", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/forms/signup-form.ts",
      'import { useForm } from "react-hook-form";\n\nexport const form = useForm();\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/forms/index.ts",
      'export { form } from "./signup-form";\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/signup.ts",
      ['import { form } from "./forms";', "", 'form.watch("email-address");', ""].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("does not follow a third re-export step", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/flags/client/setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/flags/client/index.ts",
      'export { client } from "./setup";\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/flags/index.ts",
      'export { client } from "./client";\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/index.ts",
      'export { client } from "./flags";\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", callsThroughLocalClient("./lib"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("follows an import through a path alias declared in tsconfig.json", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout/page.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/checkout/page.ts", "js-client"],
    ]);
  });

  it("follows a path alias declared in a config that tsconfig.json extends", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "config/tsconfig.base.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["../src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ extends: "./config/tsconfig.base.json", compilerOptions: { strict: true } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a path alias from the last relative config of an extends array that declares one", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.stubs.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./stubs/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.paths.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({
        extends: ["./tsconfig.stubs.json", "./tsconfig.paths.json", "@tsconfig/node20/tsconfig.json"],
      }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "stubs/lib/config-director.ts",
      "export const client = { getValue: () => false };\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows the path alias that the last config of an extends array inherits from a base an earlier config also extends", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.stubs.json",
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: { paths: { "@/*": ["./stubs/*"] } },
      }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.strict.json",
      JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { strict: true } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ extends: ["./tsconfig.stubs.json", "./tsconfig.strict.json"] }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "stubs/lib/config-director.ts",
      "export const client = { getValue: () => false };\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows an extends written without the .json extension", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ extends: "./tsconfig.base" }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("does not follow an extends that names a package rather than a relative path", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ extends: "tsconfig.base.json" }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("follows a path alias when configs extend each other in a cycle", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.base.json",
      JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ extends: "./tsconfig.base.json" }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a path alias declared only in a config that tsconfig.json references, as in Vite's template", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }],
      }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.app.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } }, include: ["src"] }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.node.json",
      JSON.stringify({ include: ["vite.config.ts"] }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a path alias declared in the tsconfig.json of a directory that tsconfig.json references", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ files: [], references: [{ path: "./app" }] }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "app/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "server/checkout.ts",
      callsThroughLocalClient("~/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "server/checkout.ts", "js-client"]]);
  });

  it("follows the path alias of the first referenced config whose pattern matches the import", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.stubs.json" }],
      }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.app.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.stubs.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./stubs/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "stubs/lib/config-director.ts",
      "export const client = { getValue: () => false };\n",
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("does not try a later referenced config when the first match finds no file", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.generated.json" }, { path: "./tsconfig.app.json" }],
      }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.generated.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./generated/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.app.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("does not follow a bare import from the baseUrl of a referenced config", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.app.json",
      JSON.stringify({ compilerOptions: { baseUrl: "./src" } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("does not read the referenced configs when tsconfig.json declares its own path aliases", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./generated/*"] } },
        references: [{ path: "./tsconfig.app.json" }],
      }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.app.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("reads a tsconfig.json with comments, trailing commas and a path alias key that looks like a comment", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      [
        "{",
        "  // Aliases shared with the bundler",
        '  "compilerOptions": {',
        '    /* "@/*" is the src directory */',
        '    "paths": {',
        '      "@/*": ["./src/*",],',
        "    },",
        "  },",
        "}",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("reads a tsconfig.json that starts with a byte order mark", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      `\uFEFF${JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } })}`,
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("skips a tsconfig.json that cannot be parsed, without an error", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] }\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output, stderr } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("follows an import through a path alias declared in jsconfig.json", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "jsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.js", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.js",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.js", "js-client"]]);
  });

  it("follows the path alias of tsconfig.json rather than jsconfig.json in the same directory", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "jsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./stubs/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "stubs/lib/config-director.ts",
      "export const client = { getValue: () => false };\n",
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a path alias inside a re-export step", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/flags/setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/index.ts",
      'export { client } from "@/flags/setup";\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", callsThroughLocalClient("./lib"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("skips a look-alike call in a file whose path alias reaches no client", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/forms/signup-form.ts",
      'import { useForm } from "react-hook-form";\n\nexport const form = useForm();\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/signup.ts",
      ['import { form } from "@/forms/signup-form";', "", 'form.watch("email-address");', ""].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("follows a path alias declared in a tsconfig.json outside the scanned directory", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, ["src"]);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a path alias declared in a gitignored config that tsconfig.json extends, as Nuxt generates", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, ".gitignore", ".nuxt\n");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      ".nuxt/tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "~/*": ["../*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ extends: "./.nuxt/tsconfig.json" }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "utils/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "pages/checkout.ts",
      callsThroughLocalClient("~/utils/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "pages/checkout.ts", "js-client"]]);
  });

  it("follows the path alias with the longest prefix when several match", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"], "@/lib/*": ["./shared/*"] } } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/lib/config-director.ts",
      "export const client = { getValue: () => false };\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "shared/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@/lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows an exact path alias rather than a wildcard one", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          paths: { "*": ["./src/stubs/*"], "config-director": ["./src/config-director-setup.ts"] },
        },
      }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/stubs/config-director.ts",
      "export const client = { getValue: () => false };\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/config-director-setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows a bare import from the baseUrl declared in tsconfig.json", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: "./src" } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/config-director.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout/page.ts",
      callsThroughLocalClient("lib/config-director"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/checkout/page.ts", "js-client"],
    ]);
  });

  it("resolves path alias targets from the baseUrl when tsconfig.json declares one", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: "./src", paths: { "@flags/*": ["lib/flags/*"] } } }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/lib/flags/setup.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      callsThroughLocalClient("@flags/setup"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "src/checkout.ts", "js-client"]]);
  });

  it("follows an import of the current directory as a relative import rather than through the baseUrl", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: "./src" } }),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/index.ts",
      "export const client = { getValue: () => false };\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/flags/index.ts", clientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/flags/checkout.ts",
      callsThroughLocalClient("."),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/flags/checkout.ts", "js-client"],
    ]);
  });

  it("follows a Python import of a module next to the file, as the docs show", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "config_director_setup.py",
      'from configdirector import create_client\n\nclient = create_client("YOUR-SERVER-SDK-KEY")\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "main.py",
      'from config_director_setup import client\n\nretries = client.get_value("max-retries", 3)\n',
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["max-retries", "main.py", "python"]]);
  });

  it("follows a relative Python import within a package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/flags.py",
      'from configdirector import create_client\n\nclient = create_client("YOUR-SERVER-SDK-KEY")\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/checkout.py",
      'from .flags import client\n\nNEW_CHECKOUT = client.get_value("new-checkout", False)\n',
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "shop/checkout.py", "python"]]);
  });

  it("follows an absolute Python import of a package module from a file deeper in the package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/shop/flags.py",
      'import configdirector\n\nclient = configdirector.create_client("YOUR-SERVER-SDK-KEY")\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/shop/views/checkout.py",
      'from shop.flags import client\n\nNEW_CHECKOUT = client.get_value("new-checkout", False)\n',
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/shop/views/checkout.py", "python"],
    ]);
  });

  it("follows a Python package whose __init__.py imports the client from a module of the package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/flags.py",
      'from configdirector import create_client\n\nclient = create_client("YOUR-SERVER-SDK-KEY")\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "shop/__init__.py", "from .flags import client\n");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "checkout.py",
      'from shop import client\n\nNEW_CHECKOUT = client.get_value("new-checkout", False)\n',
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "checkout.py", "python"]]);
  });

  it("does not follow an absolute import in a Python package's __init__.py", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/flags.py",
      'from configdirector import create_client\n\nclient = create_client("YOUR-SERVER-SDK-KEY")\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/__init__.py",
      "from shop.flags import client\n",
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "checkout.py",
      'from shop import client\n\nNEW_CHECKOUT = client.get_value("new-checkout", False)\n',
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("does not follow the imports of a Python module other than __init__.py", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/flags.py",
      'from configdirector import create_client\n\nclient = create_client("YOUR-SERVER-SDK-KEY")\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "shop/services.py", "from .flags import client\n");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "checkout.py",
      'from shop.services import client\n\nNEW_CHECKOUT = client.get_value("new-checkout", False)\n',
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("follows a Dart package import of the app's own package to its lib directory", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/pubspec.yaml", "name: shop\nversion: 1.0.0\n");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/lib/config_director_setup.dart",
      [
        "import 'package:configdirector_flutter_client_sdk/configdirector_flutter_client_sdk.dart';",
        "",
        "final client = ConfigDirectorClient(clientSdkKey: 'YOUR-CLIENT-SDK-KEY');",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/lib/pages/checkout_page.dart",
      [
        "import 'package:shop/config_director_setup.dart';",
        "",
        "final newCheckout = client.getValue('new-checkout', false);",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "app/lib/pages/checkout_page.dart", "flutter"],
    ]);
  });

  it("follows a Dart barrel library that exports the client setup", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/pubspec.yaml", "name: shop\nversion: 1.0.0\n");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/lib/src/config_director_setup.dart",
      [
        "import 'package:configdirector_flutter_client_sdk/configdirector_flutter_client_sdk.dart';",
        "",
        "final client = ConfigDirectorClient(clientSdkKey: 'YOUR-CLIENT-SDK-KEY');",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/lib/shop.dart",
      "export 'src/config_director_setup.dart';\n",
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/lib/pages/checkout_page.dart",
      [
        "import 'package:shop/shop.dart';",
        "",
        "final newCheckout = client.getValue('new-checkout', false);",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "app/lib/pages/checkout_page.dart", "flutter"],
    ]);
  });

  it("follows a Go import of a package of the same module", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "go.mod", "module example.com/shop\n\ngo 1.24\n");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "flags/flags.go",
      [
        "package flags",
        "",
        'import "github.com/ConfigDirector/go-sdks/configdirector"',
        "",
        "var Client *configdirector.Client",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "cmd/shop/main.go",
      [
        "package main",
        "",
        'import "example.com/shop/flags"',
        "",
        "func newCheckout(user flags.User) bool {",
        '\treturn flags.Client.BoolValue("new-checkout", false, user)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "cmd/shop/main.go", "go"]]);
  });

  it("finds the Swift SDK calls of a file that uses the client declared in another file of its package target, as the docs show", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Package.swift", swiftPackageManifest);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/ConfigDirectorSetup.swift",
      [
        "import ConfigDirector",
        "",
        "// Creating the client makes no network calls. It throws only when the SDK key is",
        "// blank or a custom base URL is invalid.",
        'let client = try ConfigDirectorClient(clientSDKKey: "YOUR-CLIENT-SDK-KEY")',
        "",
        "// Connects and waits until config values are received, or until it times out.",
        "// After a timeout the client keeps trying to connect in the background.",
        "await client.initialize()",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/ContentView.swift",
      [
        "// Retrieve the current value. The default value decides the type the config",
        "// is read as, and is returned until the client is ready.",
        'let darkMode = client.value(for: "my-config-key", default: false)',
        "",
        "// Subscribe to value updates. The stream yields the current value right away",
        "// and then every time the evaluated value changes.",
        'for await darkMode in client.values(for: "my-config-key", default: false) {',
        '    print("Value updated: \\(darkMode)")',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(
      output.references.map((reference: { file: string; line: number; call: string; sdk: string }) => [
        reference.file,
        reference.line,
        reference.call,
        reference.sdk,
      ]),
    ).toEqual([
      ["Sources/Shop/ContentView.swift", 3, "value", "swift"],
      ["Sources/Shop/ContentView.swift", 7, "values", "swift"],
    ]);
  });

  it("finds the Swift SDK calls of a file in a subdirectory of the package target whose other subdirectory declares the client", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Package.swift", swiftPackageManifest);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/Setup/ConfigDirectorSetup.swift",
      swiftClientSetup,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/Views/ContentView.swift",
      swiftCallThroughClientOfTarget,
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "Sources/Shop/Views/ContentView.swift", "swift"],
    ]);
  });

  it("finds the Swift SDK calls of a file that uses the client declared in another file of its Xcode project", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Shop.xcodeproj/project.pbxproj", xcodeProjectFile);
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/ConfigDirectorSetup.swift", swiftClientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/Views/ContentView.swift",
      swiftCallThroughClientOfTarget,
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "Shop/Views/ContentView.swift", "swift"],
    ]);
  });

  it("skips a Swift SDK look-alike call in a package target where no file imports ConfigDirector, even when another target of the package does", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Package.swift", swiftPackageManifest);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/ShopFlags/ConfigDirectorSetup.swift",
      swiftClientSetup,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/ContentView.swift",
      swiftCallThroughClientOfTarget,
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a Swift SDK look-alike call in a package target where no file imports ConfigDirector, when the package directory also holds an Xcode project", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Package.swift", swiftPackageManifest);
    await writeRepositoryFile(sandbox.workingDirectory, "Shop.xcodeproj/project.pbxproj", xcodeProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/ShopFlags/ConfigDirectorSetup.swift",
      swiftClientSetup,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/ContentView.swift",
      swiftCallThroughClientOfTarget,
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Swift SDK calls of a file next to the file declaring the client when no Package.swift or Xcode project is above them", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "App/ConfigDirectorSetup.swift", swiftClientSetup);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "App/ContentView.swift",
      swiftCallThroughClientOfTarget,
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "App/ContentView.swift", "swift"]]);
  });

  it("finds the OpenFeature Swift calls of a file that uses the client declared in another file of its target", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Package.swift", swiftPackageManifest);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/ConfigDirectorSetup.swift",
      [
        "import ConfigDirectorOpenFeatureProvider",
        "import OpenFeature",
        "",
        'let provider = try ConfigDirectorProvider(clientSDKKey: "YOUR-CLIENT-SDK-KEY")',
        "let client = OpenFeatureAPI.shared.getClient()",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/Views/ContentView.swift",
      [
        "import SwiftUI",
        "",
        "struct ContentView: View {",
        '    let newCheckout = client.getBooleanValue(key: "new-checkout", defaultValue: false)',
        '    let theme = preferences.value(for: "theme-name", default: "light")',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "Sources/Shop/Views/ContentView.swift", "openfeature-swift"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Swift SDK calls of a file whose target declares the client in a file outside the scanned directory", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Package.swift", swiftPackageManifest);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/ConfigDirectorSetup.swift",
      swiftClientSetup,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/Shop/Views/ContentView.swift",
      swiftCallThroughClientOfTarget,
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, ["Sources/Shop/Views"]);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "Sources/Shop/Views/ContentView.swift", "swift"],
    ]);
  });

  it("finds the Go SDK calls of a file that uses the client declared in another file of its package, without a go.mod", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "main.go",
      [
        "package main",
        "",
        'import "github.com/ConfigDirector/go-sdks/configdirector"',
        "",
        "var client *configdirector.Client",
        "",
        "func currentUser() configdirector.UserContext {",
        '\treturn configdirector.UserContext{ID: "user-id"}',
        "}",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "handlers.go",
      [
        "package main",
        "",
        "func newCheckout() bool {",
        "\tuser := currentUser()",
        '\treturn client.BoolValue("new-checkout", false, user)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "handlers.go", "go"]]);
  });

  it("finds the OpenFeature Go calls of a file that uses the client declared in another file of its package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "main.go",
      [
        "package main",
        "",
        'import "github.com/open-feature/go-sdk/openfeature"',
        "",
        'var client = openfeature.NewClient("my-app")',
        "",
        "var evaluationContext = openfeature.EvaluationContext{}",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "handlers.go",
      [
        "package main",
        "",
        'import "context"',
        "",
        "func newCheckout(ctx context.Context) bool {",
        '\treturn client.Boolean(ctx, "new-checkout", false, evaluationContext)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "handlers.go", "openfeature-go"]]);
  });

  it("skips a Go SDK look-alike call in an external test package next to the package that declares the client", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "shop/shop.go", goPackageDeclaringClient);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/settings_test.go",
      [
        "package shop_test",
        "",
        'import "testing"',
        "",
        "func TestTheme(t *testing.T) {",
        '\ttheme := settings.StringValue("theme-name", "light", user)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a Go SDK look-alike call in another directory that does not import the package declaring the client", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "go.mod", "module example.com/shop\n\ngo 1.24\n");
    await writeRepositoryFile(sandbox.workingDirectory, "shop/shop.go", goPackageDeclaringClient);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/admin/settings.go",
      [
        "package shop",
        "",
        "func theme() string {",
        '\treturn settings.StringValue("theme-name", "light", user)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });
});

describe("scan Go calls", () => {
  it("tells a Go SDK read from an OpenFeature Go read of the same name, and from flag.String, by their arguments", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "main.go",
      [
        "package main",
        "",
        "import (",
        '\t"context"',
        '\t"flag"',
        "",
        '\t"github.com/ConfigDirector/go-sdks/configdirector"',
        '\t"github.com/open-feature/go-sdk/openfeature"',
        ")",
        "",
        "func read(ctx context.Context, client *configdirector.Client, flags *openfeature.Client, user configdirector.UserContext) {",
        '\tport := flag.String("port", "8080", "listen port")',
        '\ttheme := client.StringValue("theme", "light", user)',
        '\tbanner, _ := flags.StringValue(ctx, "banner-text", "", openfeature.EvaluationContext{})',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(
      output.references.map((reference: { key: string; line: number; sdk: string }) => [
        reference.key,
        reference.line,
        reference.sdk,
      ]),
    ).toEqual([
      ["theme", 13, "go"],
      ["banner-text", 14, "openfeature-go"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });
});

describe("scan Nuxt app and server", () => {
  const nuxtServerHandler = [
    "export default defineEventHandler(() => {",
    '  return useConfigDirectorClient().getValue("new-checkout", false);',
    "});",
    "",
  ].join("\n");

  const sdkFamiliesOf = (output: { references: Array<{ sdk: string }> }) =>
    output.references.map((reference) => reference.sdk);

  it("reports a useConfigDirectorClient call in the server directory next to nuxt.config as the Nuxt server SDK", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "apps/web/nuxt.config.ts",
      "export default defineNuxtConfig({});\n",
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "apps/web/server/api/checkout.get.ts",
      nuxtServerHandler,
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(sdkFamiliesOf(output)).toEqual(["nuxt-server"]);
  });

  it("reports a useConfigDirectorServerClient call in the server directory next to nuxt.config as the Nuxt server SDK", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "apps/web/nuxt.config.ts",
      "export default defineNuxtConfig({});\n",
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "apps/web/server/api/checkout.get.ts",
      [
        "export default defineEventHandler(() => {",
        '  return useConfigDirectorServerClient().getValue("new-checkout", false);',
        "});",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(sdkFamiliesOf(output)).toEqual(["nuxt-server"]);
  });

  it("reports a Nuxt call in a directory named server elsewhere in the app as the Nuxt client SDK", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "nuxt.config.ts",
      "export default defineNuxtConfig({});\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "app/components/server/Status.ts", nuxtServerHandler);

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(sdkFamiliesOf(output)).toEqual(["nuxt-client"]);
  });

  it("reports a Nuxt call as the Nuxt client SDK when no nuxt.config is above it", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "server/api/checkout.get.ts", nuxtServerHandler);

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(sdkFamiliesOf(output)).toEqual(["nuxt-client"]);
  });
});

describe("scan JVM build modules", () => {
  const javaCall = [
    "package com.example.checkout;",
    "",
    "import com.configdirector.ConfigDirectorClient;",
    "",
    "class Checkout {",
    "    boolean enabled(ConfigDirectorClient client) {",
    '        return client.getBoolean("new-checkout", false);',
    "    }",
    "}",
    "",
  ].join("\n");

  it("reports a com.configdirector call as the Android SDK when the nearest build file is an Android module", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "build.gradle.kts", 'plugins {\n    id("java")\n}\n');
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/build.gradle.kts",
      'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example"\n}\n',
    );
    await writeRepositoryFile(sandbox.workingDirectory, "app/src/main/java/Checkout.java", javaCall);

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references.map((reference: { sdk: string }) => reference.sdk)).toEqual(["android"]);
  });

  it("reports a com.configdirector call as the Java server SDK when the nearest build file is not an Android module", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/build.gradle.kts",
      'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example"\n}\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "server/build.gradle",
      "plugins {\n    id 'java'\n}\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "server/src/main/java/Checkout.java", javaCall);

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references.map((reference: { sdk: string }) => reference.sdk)).toEqual(["java"]);
  });
});

describe("scan holder classes", () => {
  const androidModuleBuildFile =
    'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example.app"\n}\n';

  const kotlinObjectHolder = (packageName: string) =>
    [
      `package ${packageName}`,
      "",
      "import com.configdirector.ConfigDirectorClient",
      "",
      "object Flags {",
      "    lateinit var client: ConfigDirectorClient",
      "}",
      "",
    ].join("\n");

  const mavenProjectFile = [
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>com.example</groupId>",
    "  <artifactId>shop</artifactId>",
    "  <version>1.0.0</version>",
    "</project>",
    "",
  ].join("\n");

  const javaClassHolder = [
    "package com.example;",
    "",
    "import com.configdirector.ConfigDirector;",
    "import com.configdirector.ConfigDirectorClient;",
    "",
    "public final class Flags {",
    '    public static final ConfigDirectorClient CLIENT = ConfigDirector.client("YOUR-SERVER-SDK-KEY");',
    "}",
    "",
  ].join("\n");

  const csharpProjectFile = [
    '<Project Sdk="Microsoft.NET.Sdk.Web">',
    "  <PropertyGroup>",
    "    <TargetFramework>net8.0</TargetFramework>",
    "  </PropertyGroup>",
    "</Project>",
    "",
  ].join("\n");

  const csharpStaticHolder = [
    "namespace Shop.Configuration;",
    "",
    "public static class Flags",
    "{",
    "    public static ConfigDirectorClient Client { get; set; } = null!;",
    "}",
    "",
  ].join("\n");

  it("finds the Android SDK calls of a Kotlin file through an object of its package that holds the client", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/build.gradle.kts", androidModuleBuildFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Flags.kt",
      kotlinObjectHolder("com.example.app"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Checkout.kt",
      [
        "package com.example.app",
        "",
        "class Checkout {",
        '    fun isNewCheckout() = Flags.client.getBoolean("new-checkout", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "app/src/main/java/com/example/app/Checkout.kt", "android"],
    ]);
  });

  it("finds the Java server SDK calls of a Java file through a holder class it imports from another package of a Maven project", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "pom.xml", mavenProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/Flags.java",
      javaClassHolder,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/web/Checkout.java",
      [
        "package com.example.web;",
        "",
        "import com.example.Flags;",
        "",
        "public class Checkout {",
        "    boolean isNewCheckout() {",
        '        return Flags.CLIENT.getBoolean("new-checkout", false);',
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/main/java/com/example/web/Checkout.java", "java"],
    ]);
  });

  it("finds the Java server SDK calls of a Java file through a static import of the client from its holder class", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "pom.xml", mavenProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/Flags.java",
      javaClassHolder,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/web/Checkout.java",
      [
        "package com.example.web;",
        "",
        "import static com.example.Flags.CLIENT;",
        "",
        "public class Checkout {",
        "    boolean isNewCheckout() {",
        '        return CLIENT.getBoolean("new-checkout", false);',
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/main/java/com/example/web/Checkout.java", "java"],
    ]);
  });

  it("finds the Java server SDK calls of a Java file through a static import of every member of its holder class", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "pom.xml", mavenProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/Flags.java",
      javaClassHolder,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/web/Checkout.java",
      [
        "package com.example.web;",
        "",
        "import static com.example.Flags.*;",
        "",
        "public class Checkout {",
        "    boolean isNewCheckout() {",
        '        return CLIENT.getBoolean("new-checkout", false);',
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/main/java/com/example/web/Checkout.java", "java"],
    ]);
  });

  it("finds the OpenFeature Java calls of a Java file through a holder class it imports that holds an OpenFeature client", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "pom.xml", mavenProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/Flags.java",
      [
        "package com.example;",
        "",
        "import dev.openfeature.sdk.Client;",
        "import dev.openfeature.sdk.OpenFeatureAPI;",
        "",
        "public final class Flags {",
        "    public static final Client CLIENT = OpenFeatureAPI.getInstance().getClient();",
        "}",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/web/Checkout.java",
      [
        "package com.example.web;",
        "",
        "import com.example.Flags;",
        "",
        "public class Checkout {",
        "    boolean isNewCheckout() {",
        '        return Flags.CLIENT.getBooleanValue("new-checkout", false);',
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "src/main/java/com/example/web/Checkout.java", "openfeature-java"],
    ]);
  });

  it("finds the Android SDK calls of a Kotlin file through a wildcard import of its holder object's package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/build.gradle.kts", androidModuleBuildFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/flags/Flags.kt",
      kotlinObjectHolder("com.example.app.flags"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/checkout/Checkout.kt",
      [
        "package com.example.app.checkout",
        "",
        "import com.example.app.flags.*",
        "",
        "class Checkout {",
        '    fun isNewCheckout() = Flags.client.getBoolean("new-checkout", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "app/src/main/java/com/example/app/checkout/Checkout.kt", "android"],
    ]);
  });

  it("skips a SharedPreferences look-alike call in a Kotlin file of the same package as a holder object it does not refer to", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/build.gradle.kts", androidModuleBuildFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Flags.kt",
      kotlinObjectHolder("com.example.app"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Settings.kt",
      [
        "package com.example.app",
        "",
        "import android.content.SharedPreferences",
        "",
        "class Settings(private val prefs: SharedPreferences) {",
        '    fun isDarkMode() = prefs.getBoolean("dark_mode", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the Android SDK calls of a Kotlin file through a holder object in its own directory when the directory does not end with its package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/build.gradle.kts", androidModuleBuildFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/kotlin/web/Flags.kt",
      kotlinObjectHolder("com.example.web"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/kotlin/web/Checkout.kt",
      [
        "package com.example.web",
        "",
        "class Checkout {",
        '    fun isNewCheckout() = Flags.client.getBoolean("new-checkout", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "app/src/main/kotlin/web/Checkout.kt", "android"],
    ]);
  });

  it("does not follow the imports of a Kotlin file whose directory does not end with its package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/build.gradle.kts", androidModuleBuildFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/com/example/Flags.kt",
      kotlinObjectHolder("com.example"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/kotlin/web/Checkout.kt",
      [
        "package com.example.web",
        "",
        "import com.example.Flags",
        "",
        "class Checkout {",
        '    fun isNewCheckout() = Flags.client.getBoolean("new-checkout", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the .NET SDK calls of a C# file through a static holder class in another folder of its project when a global using brings in the SDK", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Shop.csproj", csharpProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/GlobalUsings.cs",
      "global using ConfigDirector;\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Configuration/Flags.cs", csharpStaticHolder);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/Checkout/CheckoutService.cs",
      [
        "using Shop.Configuration;",
        "",
        "namespace Shop.Checkout;",
        "",
        "public class CheckoutService",
        "{",
        '    public bool IsNewCheckout() => Flags.Client.GetValue("new-checkout", false);',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "Shop/Checkout/CheckoutService.cs", "dotnet"],
    ]);
  });

  it("skips an IConfiguration look-alike call in a C# file of a project with a holder class it does not refer to", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Shop.csproj", csharpProjectFile);
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Configuration/Flags.cs", csharpStaticHolder);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/Settings/FeatureSettings.cs",
      [
        "using Microsoft.Extensions.Configuration;",
        "",
        "namespace Shop.Settings;",
        "",
        "public class FeatureSettings(IConfiguration configuration)",
        "{",
        '    public bool IsFeatureX => configuration.GetValue("FeatureX", false);',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("finds the .NET SDK calls of a C# file through a holder class outside the scanned directory", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Shop.csproj", csharpProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/GlobalUsings.cs",
      "global using ConfigDirector;\n",
    );
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Configuration/Flags.cs", csharpStaticHolder);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/Checkout/CheckoutService.cs",
      [
        "namespace Shop.Checkout;",
        "",
        "public class CheckoutService",
        "{",
        '    public bool IsNewCheckout() => Shop.Configuration.Flags.Client.GetValue("new-checkout", false);',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, ["Shop/Checkout"]);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["new-checkout", "Shop/Checkout/CheckoutService.cs", "dotnet"],
    ]);
  });

  it("does not count a same-named file in the bin or obj directory of a C# project as a holder class", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Shop.csproj", csharpProjectFile);
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/bin/Debug/Flags.cs", csharpStaticHolder);
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/obj/Debug/Flags.cs", csharpStaticHolder);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/Checkout/CheckoutService.cs",
      [
        "namespace Shop.Checkout;",
        "",
        "public class CheckoutService",
        "{",
        '    public bool IsNewCheckout() => Flags.Client.GetValue("new-checkout", false);',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("does not count a same-named file in a directory that the scan always skips as a C# holder class", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Shop.csproj", csharpProjectFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/ClientApp/node_modules/flags/Flags.cs",
      csharpStaticHolder,
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/Checkout/CheckoutService.cs",
      [
        "namespace Shop.Checkout;",
        "",
        "public class CheckoutService",
        "{",
        '    public bool IsNewCheckout() => Flags.Client.GetValue("new-checkout", false);',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a .NET SDK call through a holder class in a C# file with no project file above it", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "Shop/Configuration/Flags.cs", csharpStaticHolder);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Shop/Checkout/CheckoutService.cs",
      [
        "using Shop.Configuration;",
        "",
        "namespace Shop.Checkout;",
        "",
        "public class CheckoutService",
        "{",
        '    public bool IsNewCheckout() => Flags.Client.GetValue("new-checkout", false);',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("does not follow the holder classes that a holder class refers to", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/build.gradle.kts", androidModuleBuildFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Flags.kt",
      kotlinObjectHolder("com.example.app"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Features.kt",
      ["package com.example.app", "", "object Features {", "    val flags = Flags", "}", ""].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Checkout.kt",
      [
        "package com.example.app",
        "",
        "class Checkout {",
        '    fun isNewCheckout() = Features.flags.client.getBoolean("new-checkout", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a Kotlin call through a top-level client declared in another file of the same package", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "app/build.gradle.kts", androidModuleBuildFile);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/ConfigDirectorSetup.kt",
      [
        "package com.example.app",
        "",
        "import com.configdirector.ConfigDirectorClient",
        "",
        "lateinit var client: ConfigDirectorClient",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Checkout.kt",
      [
        "package com.example.app",
        "",
        "class Checkout {",
        '    fun isNewCheckout() = client.getBoolean("new-checkout", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.references).toEqual([]);
    expect(output.dynamicReferences).toEqual([]);
  });
});

describe("scan OpenFeature provider imports", () => {
  it("skips a Swift SDK look-alike call in a file that imports only the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "Sources/App/ConfigDirectorSetup.swift",
      [
        "import ConfigDirectorOpenFeatureProvider",
        "import OpenFeature",
        "",
        'let provider = try ConfigDirectorProvider(clientSDKKey: "YOUR-CLIENT-SDK-KEY")',
        "let client = OpenFeatureAPI.shared.getClient()",
        'let darkMode = client.getBooleanValue(key: "dark-mode", defaultValue: false)',
        'let theme = preferences.value(for: "theme-name", default: "light")',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["dark-mode", "Sources/App/ConfigDirectorSetup.swift", "openfeature-swift"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a Java SDK look-alike call in a file that imports only the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/main/java/com/example/checkout/Flags.java",
      [
        "package com.example.checkout;",
        "",
        "import com.configdirector.openfeature.ConfigDirectorProvider;",
        "import dev.openfeature.sdk.Client;",
        "import dev.openfeature.sdk.OpenFeatureAPI;",
        "import java.util.prefs.Preferences;",
        "",
        "class Flags {",
        "    boolean darkMode(Client client) {",
        '        return client.getBooleanValue("dark-mode", false);',
        "    }",
        "",
        "    boolean onboarded(Preferences preferences) {",
        '        return preferences.getBoolean("onboarding-done", false);',
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["dark-mode", "src/main/java/com/example/checkout/Flags.java", "openfeature-java"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips an Android SDK look-alike call in a file that imports only the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/build.gradle.kts",
      'plugins {\n    id("com.android.application")\n}\n\nandroid {\n    namespace = "com.example"\n}\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "app/src/main/java/com/example/app/Flags.kt",
      [
        "package com.example.app",
        "",
        "import android.content.SharedPreferences",
        "import com.configdirector.openfeature.ConfigDirectorProvider",
        "import dev.openfeature.kotlin.sdk.OpenFeatureAPI",
        "",
        "fun readFlags(preferences: SharedPreferences) {",
        "    val client = OpenFeatureAPI.getClient()",
        '    val darkMode = client.getBooleanValue("dark-mode", false)',
        '    val onboarded = preferences.getBoolean("onboarding-done", false)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["dark-mode", "app/src/main/java/com/example/app/Flags.kt", "openfeature-android"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a Python SDK look-alike call in a file that imports only the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "config_director_setup.py",
      [
        "from configdirector_openfeature import ConfigDirectorProvider",
        "from openfeature import api",
        "",
        'api.set_provider_and_wait(ConfigDirectorProvider("YOUR-SERVER-SDK-KEY"))',
        "client = api.get_client()",
        'dark_mode = client.get_boolean_value("dark-mode", False)',
        'theme = settings.get_value("theme-name", "light")',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["dark-mode", "config_director_setup.py", "openfeature-python"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a .NET SDK look-alike call in a file that imports only the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "ConfigDirectorSetup.cs",
      [
        "using ConfigDirector.OpenFeature;",
        "using OpenFeature;",
        "",
        'await Api.Instance.SetProviderAsync(new ConfigDirectorProvider("YOUR-SERVER-SDK-KEY"));',
        "var client = Api.Instance.GetClient();",
        'var darkMode = await client.GetBooleanValueAsync("dark-mode", false);',
        'var timeout = settings.GetValue("checkout-timeout", 30);',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["dark-mode", "ConfigDirectorSetup.cs", "openfeature-dotnet"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a Go SDK look-alike call in a file that imports only the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "flags.go",
      [
        "package main",
        "",
        "import (",
        '\t"context"',
        "",
        '\tconfigdirectoropenfeature "github.com/ConfigDirector/go-sdks/configdirector-openfeature"',
        '\t"github.com/open-feature/go-sdk/openfeature"',
        ")",
        "",
        "func readFlags(ctx context.Context, provider *configdirectoropenfeature.Provider, settings *Settings, user User) {",
        "\topenfeature.SetProvider(provider)",
        '\tclient := openfeature.NewClient("my-app")',
        '\tdarkMode := client.Boolean(ctx, "dark-mode", false, openfeature.EvaluationContext{})',
        '\ttheme := settings.StringValue("theme-name", "light", user)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["dark-mode", "flags.go", "openfeature-go"]]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("skips a Python SDK look-alike call in a file whose imported setup module imports only the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "config_director_setup.py",
      [
        "from configdirector_openfeature import ConfigDirectorProvider",
        "from openfeature import api",
        "",
        'api.set_provider_and_wait(ConfigDirectorProvider("YOUR-SERVER-SDK-KEY"))',
        "client = api.get_client()",
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "main.py",
      [
        "from config_director_setup import client",
        "",
        'dark_mode = client.get_boolean_value("dark-mode", False)',
        'theme = settings.get_value("theme-name", "light")',
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["dark-mode", "main.py", "openfeature-python"]]);
    expect(output.dynamicReferences).toEqual([]);
  });

  it("follows the client re-exported by a Python package's __init__.py that also imports the OpenFeature provider", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/flags.py",
      'from configdirector import create_client\n\nclient = create_client("YOUR-SERVER-SDK-KEY")\n',
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "shop/__init__.py",
      "from configdirector_openfeature import ConfigDirectorProvider\nfrom .flags import client\n",
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "checkout.py",
      'from shop import client\n\nNEW_CHECKOUT = client.get_value("new-checkout", False)\n',
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([["new-checkout", "checkout.py", "python"]]);
  });

  it("finds Go SDK calls in a file that imports the Go SDK alongside the OpenFeature provider, as the provider docs show", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "main.go",
      [
        "package main",
        "",
        "import (",
        '\t"context"',
        "",
        '\t"github.com/ConfigDirector/go-sdks/configdirector"',
        '\tconfigdirectoropenfeature "github.com/ConfigDirector/go-sdks/configdirector-openfeature"',
        '\t"github.com/open-feature/go-sdk/openfeature"',
        ")",
        "",
        "func readFlags(ctx context.Context, sdkClient *configdirector.Client, user configdirector.UserContext) {",
        '\tprovider, _ := configdirectoropenfeature.NewProvider(configdirector.Options{SDKKey: "YOUR-SERVER-SDK-KEY"})',
        "\topenfeature.SetProvider(provider)",
        '\tclient := openfeature.NewClient("my-app")',
        '\tdarkMode := client.Boolean(ctx, "dark-mode", false, openfeature.EvaluationContext{})',
        '\ttheme := sdkClient.StringValue("theme-name", "light", user)',
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysFilesAndSdks(output)).toEqual([
      ["dark-mode", "main.go", "openfeature-go"],
      ["theme-name", "main.go", "go"],
    ]);
    expect(output.dynamicReferences).toEqual([]);
  });
});

describe("scan output", () => {
  it("prints the references grouped by key, then the dynamic references, then the counts", async () => {
    const adminApi = await startScanAdminApi({ configs: [projectConfig("new-checkout")] });
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/ab-tests.ts",
      [
        'import { isEnabled } from "./flags";',
        "",
        'export const checkout = () => isEnabled("new-checkout");',
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        'client.getValue("new-checkout", false);',
        'client.getValue("dark-mode", false);',
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/banner.ts",
      [
        'import { createClient } from "@configdirector/server-sdk";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        'client.getValue("new-checkout", false);',
        "export const banner = (flagKey: string) => client.getValue(flagKey, false);",
        "",
      ].join("\n"),
    );

    const { exitCode, stdout } = await scan(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stdout).toEqual(
      [
        "dark-mode",
        "  src/checkout.ts:5 getValue (js-server)",
        "",
        "new-checkout",
        "  src/ab-tests.ts:3 (indirect)",
        "  src/banner.ts:4 getValue (js-server)",
        "  src/checkout.ts:4 getValue (js-server)",
        "",
        "Dynamic references (calls whose key is not a string literal)",
        "  src/banner.ts:5 getValue(flagKey) (js-server)",
        "",
        "3 direct, 1 indirect and 1 dynamic references in 3 scanned files.",
        "",
      ].join("\n"),
    );
  });

  it("exits 0 saying there was nothing to scan when no file can be scanned", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "README.md", "# Web App\n");

    const { exitCode, stdout } = await scan(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("No source files to scan");
  });

  it("prints JSON that the scan output schema shipped in the package accepts", async () => {
    const adminApi = await startScanAdminApi({ configs: [projectConfig("new-checkout", ["checkout-v2"])] });
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      [
        'import { createClient } from "@configdirector/server-sdk";',
        'import { OpenFeature } from "@openfeature/server-sdk";',
        'import { isEnabled } from "./wrapper";',
        "",
        'const client = createClient("YOUR-SERVER-SDK-KEY");',
        'const DARK_MODE_FLAG = "dark-mode";',
        'client.getValue("new-checkout", false);',
        "client.getValue(flagKey, false);",
        "OpenFeature.getClient().getBooleanValue(DARK_MODE_FLAG, false);",
        'isEnabled("checkout-v2");',
        "",
      ].join("\n"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "test/checkout.test.ts",
      [
        'import { createTestClient } from "@configdirector/server-sdk/testing";',
        "",
        'const testClient = createTestClient({ values: { "new-checkout": true } });',
        'testClient.setValue("new-checkout", false);',
        "",
      ].join("\n"),
    );
    const validateScanOutput = await scanOutputSchemaValidator();

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(
      output.references.map(
        (reference: { kind: string; argument?: string; snippet: { firstLine: number } }) => [
          reference.kind,
          reference.argument,
          reference.snippet.firstLine,
        ],
      ),
    ).toEqual([
      ["direct", undefined, 5],
      ["direct", "DARK_MODE_FLAG", 7],
      ["indirect", undefined, 8],
      ["direct", undefined, 1],
      ["direct", undefined, 2],
    ]);
    expect(output.dynamicReferences.length).toEqual(1);
    expect(validateScanOutput(output)).toEqual(true);
    expect(validateScanOutput.errors).toEqual(null);
  });
});

describe("scan scope", () => {
  it("skips files that .gitignore ignores, in the scanned directory and below", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, ".gitignore", "generated/\n");
    await writeRepositoryFile(sandbox.workingDirectory, "packages/web/.gitignore", "*.local.ts\n");
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "generated/flags.ts",
      serverSdkCall("generated-flag"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "packages/web/dev.local.ts",
      serverSdkCall("local-flag"),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "packages/web/app.ts", serverSdkCall("web-flag"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([
      ["web-flag", "packages/web/app.ts"],
      ["new-checkout", "src/checkout.ts"],
    ]);
  });

  it("applies the .gitignore of the current directory when scanning a directory below it", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, ".gitignore", "src/generated/\n");
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/generated/flags.ts",
      serverSdkCall("generated-flag"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, ["src"]);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("applies the .gitignore of the git repository root above the current directory", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await mkdir(join(sandbox.root, ".git"));
    await writeRepositoryFile(sandbox.root, ".gitignore", "repository/generated/\n");
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "generated/flags.ts",
      serverSdkCall("generated-flag"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("skips files over 1 MB", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    const oneMegabyte = 1024 * 1024;
    const callAtOneMegabyte = serverSdkCall("one-megabyte-flag");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/at-limit.ts",
      callAtOneMegabyte.padEnd(oneMegabyte, " "),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/over-limit.ts",
      serverSdkCall("over-limit-flag").padEnd(oneMegabyte + 1, " "),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.filesScanned).toEqual(1);
    expect(referencedKeysAndFiles(output)).toEqual([["one-megabyte-flag", "src/at-limit.ts"]]);
  });

  it("skips binary files", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "media/intro.ts",
      Buffer.concat([Buffer.from([0x47, 0x00, 0x11, 0x10]), Buffer.from(serverSdkCall("video-flag"))]),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.filesScanned).toEqual(1);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("skips node_modules, vendor, build, dist and target directories at any depth", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "node_modules/sdk/index.ts",
      serverSdkCall("module-flag"),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "app/vendor/index.ts", serverSdkCall("vendor-flag"));
    await writeRepositoryFile(sandbox.workingDirectory, "app/build/index.ts", serverSdkCall("build-flag"));
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "packages/web/dist/index.ts",
      serverSdkCall("dist-flag"),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "target/index.ts", serverSdkCall("target-flag"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(output.filesScanned).toEqual(1);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("skips files matching an exclude glob in configdirector.json", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      JSON.stringify({
        project: "web-app",
        include: ["**"],
        exclude: ["src/generated/**", "**/*.stories.ts"],
      }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/generated/flags.ts",
      serverSdkCall("generated-flag"),
    );
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/ui/banner.stories.ts",
      serverSdkCall("story-flag"),
    );

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("scans only files matching an include glob in configdirector.json", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      JSON.stringify({ project: "web-app", include: ["src/**"], exclude: [] }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(sandbox.workingDirectory, "scripts/seed.ts", serverSdkCall("seed-flag"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("scans only the directory given as the path argument", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(sandbox.workingDirectory, "scripts/seed.ts", serverSdkCall("seed-flag"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, ["src"]);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("scans only the directory given as an absolute path argument", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(sandbox.workingDirectory, "scripts/seed.ts", serverSdkCall("seed-flag"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, [
      join(sandbox.workingDirectory, "src"),
    ]);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("scans only the file given as the path argument", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));
    await writeRepositoryFile(sandbox.workingDirectory, "src/seed.ts", serverSdkCall("seed-flag"));

    const { exitCode, output } = await scanJson(sandbox, adminApi.baseUrl, ["src/checkout.ts"]);

    expect(exitCode).toEqual(0);
    expect(referencedKeysAndFiles(output)).toEqual([["new-checkout", "src/checkout.ts"]]);
  });

  it("exits 2 naming the path without calling the Admin API when the path does not exist", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await scan(sandbox, adminApi.baseUrl, ["no-such-directory"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("no-such-directory");
    expect(stdout).toEqual("");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});

const linkProject = async (sandbox: Sandbox, baseUrl: string, projectSlug: string) => {
  await run(
    sandbox.invocation({
      commandLineArguments: ["init", "--project", projectSlug, "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
    }),
  );
};

describe("scan project", () => {
  it("scans for the project that init linked when no project is given", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await linkProject(sandbox, adminApi.baseUrl, "web-app");
    const invocation = sandbox.invocation({
      commandLineArguments: ["scan", "--token", "cd_flag_token", "--json"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(invocation.stdout.text()).project).toEqual("web-app");
  });

  it("scans for the project given with CONFIGDIRECTOR_PROJECT rather than the one init linked", async () => {
    const mobileApp = {
      ...webApp,
      id: "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918",
      name: "Mobile App",
      slug: "mobile-app",
    };
    const adminApi = await startScanAdminApi({ projects: [webApp, mobileApp] });
    const sandbox = await createSandbox();
    await linkProject(sandbox, adminApi.baseUrl, "web-app");
    const invocation = sandbox.invocation({
      commandLineArguments: ["scan", "--token", "cd_flag_token", "--json"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        CONFIGDIRECTOR_PROJECT: "mobile-app",
      },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(invocation.stdout.text()).project).toEqual("mobile-app");
  });

  it("calls the project listing, then the config listing of the project, and nothing else", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "src/checkout.ts", serverSdkCall("new-checkout"));

    await scanJson(sandbox, adminApi.baseUrl);

    expect(adminApi.receivedRequests.map((request) => [request.method, request.path])).toEqual([
      ["GET", "/v1/projects"],
      ["GET", `/v1/projects/${webApp.id}/configs`],
    ]);
  });

  it("exits 2 without calling the Admin API when no project is given and there is no configdirector.json", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["scan", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("configdirector.json");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 naming configdirector.json without calling the Admin API when the file is not valid", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      '{ "project": "web-app", "exclude": "dist" }',
    );

    const { exitCode, stdout, stderr } = await scan(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("configdirector.json");
    expect(stdout).toEqual("");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 naming CONFIGDIRECTOR_TOKEN without calling the Admin API when no token is found", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["scan", "--project", "web-app"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("CONFIGDIRECTOR_TOKEN");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 naming the slug when no project in the organization has it", async () => {
    const adminApi = await startScanAdminApi();
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["scan", "--project", "checkout-service", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("checkout-service");
    expect(invocation.stdout.text()).toEqual("");
  });
});
