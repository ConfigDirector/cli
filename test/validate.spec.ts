import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox } from "./support/sandbox.js";
import { projectConfig } from "./support/scan-admin-api.js";
import { serverSdkSetup, validateRepositoryJson, validateRepositoryText } from "./support/scan-repository.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const adminLinkFile = [
  'import { useConfigValue } from "@configdirector/react-web-sdk";',
  "",
  'export const useAdminLink = () => useConfigValue("admin-panel", false);',
];

const javaCheckoutFile = [
  "package com.example.checkout;",
  "",
  "import com.configdirector.ConfigDirectorClient;",
  "",
  "class Checkout {",
  "    boolean bannerShown(ConfigDirectorClient client, boolean fallback) {",
  '        return client.getBoolean("checkout-banner", fallback);',
  "    }",
  "}",
];

const validateOutputSchema = async () =>
  new Ajv2020({ allErrors: true }).compile(
    JSON.parse(await readFile(new URL("../schema/scan-output.schema.json", import.meta.url), "utf8")),
  );

describe("validate", () => {
  it("reports a key that is no current or deprecated key of any config as an unknown key and exits 1", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("old-checkout", false);'] },
      [projectConfig("new-checkout", ["checkout-v2"])],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      { kind: "unknown-key", key: "old-checkout", file: "src/checkout.ts", line: 4 },
    ]);
  });

  it("reports a deprecated key as a deprecated key naming the config's current key and exits 1", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("checkout-v2", false);'] },
      [projectConfig("new-checkout", ["checkout-v2"])],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "deprecated-key",
        key: "checkout-v2",
        file: "src/checkout.ts",
        line: 4,
        currentKey: "new-checkout",
      },
    ]);
  });

  it("reports an in-code default value of a type the config does not serve as a type mismatch and exits 1", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("new-checkout", "on");'] },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "type-mismatch",
        key: "new-checkout",
        file: "src/checkout.ts",
        line: 4,
        configType: "boolean",
        servedAs: "boolean",
        default: { type: "string", value: "on" },
      },
    ]);
  });

  it("reports a client SDK reading a server-only config as an availability mismatch and exits 1", async () => {
    const { exitCode, output } = await validateRepositoryJson({ "src/admin-link.tsx": adminLinkFile }, [
      projectConfig("admin-panel", [], { client: false, server: true }),
    ]);

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "availability-mismatch",
        key: "admin-panel",
        file: "src/admin-link.tsx",
        line: 3,
        sdk: "react",
        sdkType: "client",
        configAvailableTo: ["server"],
      },
    ]);
  });

  it("reports a server SDK reading a client-only config as an availability mismatch and exits 1", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("new-checkout", false);'] },
      [projectConfig("new-checkout", [], { client: true, server: false })],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "availability-mismatch",
        key: "new-checkout",
        file: "src/checkout.ts",
        line: 4,
        sdk: "js-server",
        sdkType: "server",
        configAvailableTo: ["client"],
      },
    ]);
  });

  it("reports a string in-code default value that is not one of an enum's allowed values and exits 1", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/theme.ts": [...serverSdkSetup, 'client.getValue("color-theme", "purple");'] },
      [
        projectConfig("color-theme", [], {
          type: "enum",
          typeOptions: { valueType: "string", values: ["light", "dark"] },
        }),
      ],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "enum-value-not-allowed",
        key: "color-theme",
        file: "src/theme.ts",
        line: 4,
        default: { type: "string", value: "purple" },
        allowedValues: ["light", "dark"],
      },
    ]);
  });

  it("reports a deprecated key read with an in-code default value of another type as both a deprecated key and a type mismatch", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("checkout-v2", "on");'] },
      [projectConfig("new-checkout", ["checkout-v2"])],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "deprecated-key",
        key: "checkout-v2",
        file: "src/checkout.ts",
        line: 4,
        currentKey: "new-checkout",
      },
      {
        kind: "type-mismatch",
        key: "checkout-v2",
        file: "src/checkout.ts",
        line: 4,
        configType: "boolean",
        servedAs: "boolean",
        default: { type: "string", value: "on" },
      },
    ]);
  });

  it("checks the keys a test client sets for unknown and deprecated keys, not availability, since ConfigDirector never serves a test client", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      {
        "test/admin-link.test.tsx": [
          'import { createTestClient } from "@configdirector/react-web-sdk/testing";',
          "",
          'const testClient = createTestClient({ values: { "admin-panel": true, "checkout-v2": false } });',
        ],
      },
      [projectConfig("admin-panel", [], { client: false }), projectConfig("new-checkout", ["checkout-v2"])],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "deprecated-key",
        key: "checkout-v2",
        file: "test/admin-link.test.tsx",
        line: 3,
        currentKey: "new-checkout",
      },
    ]);
  });
});

describe("validate types", () => {
  it("accepts an integer in-code default value for a float config", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("discount-rate", 0);'] },
      [projectConfig("discount-rate", [], { type: "float" })],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });

  it("reports a float in-code default value for an integer config as a type mismatch", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("page-size", 2.5);'] },
      [projectConfig("page-size", [], { type: "integer" })],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "type-mismatch",
        key: "page-size",
        file: "src/checkout.ts",
        line: 4,
        configType: "integer",
        servedAs: "integer",
        default: { type: "float", value: 2.5 },
      },
    ]);
  });

  it("reports a typed getter reading a string config as a boolean as a type mismatch when the call passes no literal in-code default value", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      {
        "src/main/java/com/example/checkout/Checkout.java": javaCheckoutFile,
      },
      [projectConfig("checkout-banner", [], { type: "string" })],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "type-mismatch",
        key: "checkout-banner",
        file: "src/main/java/com/example/checkout/Checkout.java",
        line: 7,
        configType: "string",
        servedAs: "string",
        getterType: "boolean",
      },
    ]);
  });

  it("reports a string in-code default value for a timespan config, which the SDKs serve as a float, as a type mismatch", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("checkout-timeout", "30s");'] },
      [projectConfig("checkout-timeout", [], { type: "timespan" })],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "type-mismatch",
        key: "checkout-timeout",
        file: "src/checkout.ts",
        line: 4,
        configType: "timespan",
        servedAs: "float",
        default: { type: "string", value: "30s" },
      },
    ]);
  });

  it("accepts an integer in-code default value for a timespan config", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("checkout-timeout", 30);'] },
      [projectConfig("checkout-timeout", [], { type: "timespan" })],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });

  it("reports a boolean in-code default value for a URL config, which the SDKs serve as a string, as a type mismatch", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("help-page-url", false);'] },
      [projectConfig("help-page-url", [], { type: "url" })],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "type-mismatch",
        key: "help-page-url",
        file: "src/checkout.ts",
        line: 4,
        configType: "url",
        servedAs: "string",
        default: { type: "boolean", value: false },
      },
    ]);
  });

  it("accepts an integer in-code default value that is one of a number enum's allowed values", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("items-per-row", 4);'] },
      [
        projectConfig("items-per-row", [], {
          type: "enum",
          typeOptions: { valueType: "number", values: ["2", "4", "6"] },
        }),
      ],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });

  it("reports an integer in-code default value that is not one of a number enum's allowed values", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("items-per-row", 5);'] },
      [
        projectConfig("items-per-row", [], {
          type: "enum",
          typeOptions: { valueType: "number", values: ["2", "4", "6"] },
        }),
      ],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "enum-value-not-allowed",
        key: "items-per-row",
        file: "src/checkout.ts",
        line: 4,
        default: { type: "integer", value: 5 },
        allowedValues: ["2", "4", "6"],
      },
    ]);
  });

  it("reports an integer in-code default value for a string enum as a type mismatch", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/theme.ts": [...serverSdkSetup, 'client.getValue("color-theme", 1);'] },
      [
        projectConfig("color-theme", [], {
          type: "enum",
          typeOptions: { valueType: "string", values: ["light", "dark"] },
        }),
      ],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "type-mismatch",
        key: "color-theme",
        file: "src/theme.ts",
        line: 4,
        configType: "enum",
        servedAs: "string-enum",
        default: { type: "integer", value: 1 },
      },
    ]);
  });

  it("checks a config of a type this release does not know for its key and availability, not its type", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("launch-date", false);'] },
      [projectConfig("launch-date", [], { type: "date", server: false })],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings).toEqual([
      {
        kind: "availability-mismatch",
        key: "launch-date",
        file: "src/checkout.ts",
        line: 4,
        sdk: "js-server",
        sdkType: "server",
        configAvailableTo: ["client"],
      },
    ]);
  });

  it("checks an enum whose values are of a type this release does not know for its key and availability, not its type", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("launch-day", false);'] },
      [
        projectConfig("launch-day", [], {
          type: "enum",
          typeOptions: { valueType: "date", values: ["2026-11-02", "2026-11-09"] },
        }),
      ],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });

  it("accepts a number getter for an integer config", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      {
        "src/checkout.ts": [
          'import { OpenFeature } from "@openfeature/server-sdk";',
          "",
          "const client = OpenFeature.getClient();",
          'export const pageSize = () => client.getNumberValue("page-size", 10);',
        ],
      },
      [projectConfig("page-size", [], { type: "integer" })],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });

  it("accepts a float in-code default value that is one of a number enum's allowed values", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("zoom-level", 1.5);'] },
      [
        projectConfig("zoom-level", [], {
          type: "enum",
          typeOptions: { valueType: "number", values: ["0.5", "1.5"] },
        }),
      ],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });
});

describe("validate settings", () => {
  it("reports nothing for an unknown key listed in ignoreKeys in configdirector.json and exits 0", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      {
        "configdirector.json": [
          '{ "project": "web-app", "ignoreKeys": ["billing-flag-from-other-project"] }',
        ],
        "src/billing.ts": [...serverSdkSetup, 'client.getValue("billing-flag-from-other-project", false);'],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });

  it("reports nothing for a file matching an exclude glob in configdirector.json", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      {
        "configdirector.json": ['{ "project": "web-app", "exclude": ["src/generated/**"] }'],
        "src/generated/flags.ts": [...serverSdkSetup, 'client.getValue("generated-flag", false);'],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });
});

describe("validate output", () => {
  it("prints the findings grouped by kind with what to do, then the counts", async () => {
    const { exitCode, stdout } = await validateRepositoryText(
      {
        "src/admin-link.tsx": adminLinkFile,
        "src/checkout.ts": [
          ...serverSdkSetup,
          'client.getValue("old-checkout", false);',
          'client.getValue("checkout-v2", false);',
          'client.getValue("page-size", 2.5);',
          'client.getValue("color-theme", "purple");',
          'client.getValue("checkout-timeout", "30s");',
          "export const settingValue = (settingKey: string) => client.getValue(settingKey, false);",
        ],
      },
      [
        projectConfig("new-checkout", ["checkout-v2"]),
        projectConfig("page-size", [], { type: "integer" }),
        projectConfig("color-theme", [], {
          type: "enum",
          typeOptions: { valueType: "string", values: ["light", "dark"] },
        }),
        projectConfig("checkout-timeout", [], { type: "timespan" }),
        projectConfig("admin-panel", [], { client: false }),
      ],
    );

    expect(exitCode).toEqual(1);
    expect(stdout).toEqual(
      [
        "Unknown keys",
        "  src/checkout.ts:4 old-checkout: no config in web-app has this key.",
        "",
        "Deprecated keys",
        "  src/checkout.ts:5 checkout-v2: the config was renamed to new-checkout.",
        "",
        "Type mismatches",
        "  src/checkout.ts:6 page-size: read as float, but the config's type is integer.",
        "  src/checkout.ts:8 checkout-timeout: read as string, but the config's type is timespan, served as a float.",
        "",
        "Availability mismatches",
        "  src/admin-link.tsx:3 admin-panel: read from a client SDK (react), but the config is server-only.",
        "",
        "Enum values not allowed",
        '  src/checkout.ts:7 color-theme: "purple" is not one of the allowed values: light, dark.',
        "",
        "Checked 6 direct references in 2 scanned files and found 6 problems. " +
          "1 dynamic reference was not checked.",
        "",
      ].join("\n"),
    );
  });

  it("prints only the counts when every key the code reads is right", async () => {
    const { exitCode, stdout } = await validateRepositoryText(
      { "src/checkout.ts": [...serverSdkSetup, 'client.getValue("new-checkout", false);'] },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(stdout).toEqual("Checked 1 direct reference in 1 scanned file and found no problems.\n");
  });

  it("prints JSON with every finding kind that the output schema shipped in the package accepts", async () => {
    const validateOutput = await validateOutputSchema();

    const { exitCode, output } = await validateRepositoryJson(
      {
        "src/admin-link.tsx": adminLinkFile,
        "src/checkout.ts": [
          ...serverSdkSetup,
          'client.getValue("old-checkout", false);',
          'client.getValue("checkout-v2", false);',
          'client.getValue("page-size", 2.5);',
          'client.getValue("color-theme", "purple");',
        ],
        "src/main/java/com/example/checkout/Checkout.java": javaCheckoutFile,
      },
      [
        projectConfig("new-checkout", ["checkout-v2"]),
        projectConfig("page-size", [], { type: "integer" }),
        projectConfig("checkout-banner", [], { type: "string" }),
        projectConfig("color-theme", [], {
          type: "enum",
          typeOptions: { valueType: "string", values: ["light", "dark"] },
        }),
        projectConfig("admin-panel", [], { client: false }),
      ],
    );

    expect(exitCode).toEqual(1);
    expect(output.findings.map((finding: { kind: string }) => finding.kind)).toEqual([
      "availability-mismatch",
      "unknown-key",
      "deprecated-key",
      "type-mismatch",
      "enum-value-not-allowed",
      "type-mismatch",
    ]);
    expect(validateOutput(output)).toEqual(true);
    expect(validateOutput.errors).toEqual(null);
  });

  it("exits 0 saying there was nothing to check when no file can be scanned", async () => {
    const { exitCode, stdout } = await validateRepositoryText({ "README.md": ["# Web App"] }, [
      projectConfig("new-checkout"),
    ]);

    expect(exitCode).toEqual(0);
    expect(stdout).toEqual("No source files to scan in the current directory.\n");
  });
});

describe("validate exit codes", () => {
  it("exits 0 with no findings when every key the code reads is right", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      {
        "src/checkout.ts": [
          ...serverSdkSetup,
          'client.getValue("new-checkout", false);',
          'client.getValue("checkout-timeout", 30);',
        ],
      },
      [projectConfig("new-checkout"), projectConfig("checkout-timeout", [], { type: "timespan" })],
    );

    expect(exitCode).toEqual(0);
    expect(output.findings).toEqual([]);
  });

  it("exits 0 with no findings when the code reads keys only through dynamic references", async () => {
    const { exitCode, output } = await validateRepositoryJson(
      {
        "src/settings.ts": [
          ...serverSdkSetup,
          "export const settingValue = (settingKey: string) => client.getValue(settingKey, false);",
        ],
      },
      [projectConfig("new-checkout")],
    );

    expect(exitCode).toEqual(0);
    expect(output.dynamicReferences).toEqual([
      { file: "src/settings.ts", line: 4, sdk: "js-server", call: "getValue", argument: "settingKey" },
    ]);
    expect(output.findings).toEqual([]);
  });

  it("exits 2 printing no finding when the Admin API refuses the token", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: { error: "The API token expired.", code: "API_TOKEN_EXPIRED" },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      [...serverSdkSetup, 'client.getValue("old-checkout", false);', ""].join("\n"),
    );
    const invocation = sandbox.invocation({
      commandLineArguments: ["validate", "--project", "web-app", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stdout.text()).toEqual("");
    expect(invocation.stderr.text()).toEqual(
      "Error: The Admin API refused the request: The API token expired. (API_TOKEN_EXPIRED)\n",
    );
  });
});
