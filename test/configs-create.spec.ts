import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import {
  checkoutTag,
  projectPath,
  requestLinesOf,
  startBrowseAdminApi,
  webTeamTag,
} from "./support/browse-admin-api.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const createConfigIn = async (sandbox: Sandbox, baseUrl: string, commandLineArguments: string[]) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "configs",
      "create",
      ...commandLineArguments,
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const createConfig = async (baseUrl: string, commandLineArguments: string[]) =>
  createConfigIn(await createSandbox(), baseUrl, commandLineArguments);

const createdConfig = (overrides: object = {}) => ({
  id: "config-new-checkout",
  projectId: webApp.id,
  tags: [],
  key: "new-checkout",
  role: "flag",
  lifetime: "temporary",
  type: "boolean",
  state: "new",
  server: true,
  client: true,
  variations: [],
  deprecatedKeys: [],
  createdAt: "2026-10-17T10:00:00.000Z",
  updatedAt: "2026-10-17T10:00:00.000Z",
  ...overrides,
});

const createRequestBodies = (adminApi: Awaited<ReturnType<typeof startBrowseAdminApi>>) =>
  adminApi.receivedRequests.filter((request) => request.method === "POST").map((request) => request.body);

const keyTakenErrors = {
  errors: [
    {
      name: "key",
      message: "The key is already in use in the current project, please use a different key",
    },
  ],
};

const existingNewCheckout = {
  ...createdConfig({ state: "in-use", description: "Shows the new checkout flow" }),
  settledValue: null,
  targets: [
    {
      id: "target-production",
      environment: {
        id: "environment-production",
        name: "Production",
        slug: "production",
        color: "red",
        live: true,
      },
      rules: [],
      defaultValue: "true",
      defaultValueId: "default-production",
    },
  ],
};

const featureFlagSettingArguments = [
  "--key",
  "new-checkout",
  "--type",
  "boolean",
  "--role",
  "flag",
  "--lifetime",
  "temporary",
];

const featureFlagArguments = [...featureFlagSettingArguments, "--default-value", "false"];

const settingArguments = (key: string, type: string) => [
  "--key",
  key,
  "--type",
  type,
  "--role",
  "config",
  "--lifetime",
  "permanent",
];

describe("configs create", () => {
  it("creates a boolean feature flag for client and server SDKs with no tags from the required options alone", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs": { status: 200, body: createdConfig() } });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, featureFlagArguments);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created new-checkout in web-app: boolean, flag, temporary, client and server SDKs.",
      "Default targeting rule in every environment: false",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${projectPath("/configs")}`]);
    expect(createRequestBodies(adminApi)).toEqual([
      {
        key: "new-checkout",
        role: "flag",
        lifetime: "temporary",
        type: "boolean",
        client: true,
        server: true,
        variations: [],
        tagIds: [],
        defaultValue: false,
      },
    ]);
  });

  it("sends the description given with --description", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 200, body: createdConfig({ description: "Shows the new checkout flow" }) },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--description",
      "Shows the new checkout flow",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created new-checkout in web-app: boolean, flag, temporary, client and server SDKs.",
      "Default targeting rule in every environment: false",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({ key: "new-checkout", description: "Shows the new checkout flow" }),
    ]);
  });

  it("sends a string config's default targeting rule value as the text given, even when it reads as a number", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "free-shipping-minimum",
          type: "string",
          role: "config",
          lifetime: "permanent",
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("free-shipping-minimum", "string"),
      "--default-value",
      "20",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created free-shipping-minimum in web-app: string, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: 20",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({ type: "string", defaultValue: "20" }),
    ]);
  });

  it("exits 2 without a request when --default-value is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, featureFlagSettingArguments);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--default-value <value>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --default-value does not parse as true or false for a boolean config", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagSettingArguments,
      "--default-value",
      "yes",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --default-value takes true or false with --type boolean, not yes.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("creates a config only client SDKs receive with --client-only", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 200, body: createdConfig({ server: false }) },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--client-only",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created new-checkout in web-app: boolean, flag, temporary, client-only.",
      "Default targeting rule in every environment: false",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([expect.objectContaining({ client: true, server: false })]);
  });

  it("creates a config only server SDKs receive with --server-only", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 200, body: createdConfig({ client: false }) },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--server-only",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created new-checkout in web-app: boolean, flag, temporary, server-only.",
      "Default targeting rule in every environment: false",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([expect.objectContaining({ client: false, server: true })]);
  });

  it("exits 2 without a request when --client-only is combined with --server-only", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--client-only",
      "--server-only",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("option '--server-only' cannot be used with option '--client-only'");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("resolves each --tag name to its tag in order and sends their ids", async () => {
    const adminApi = await startBrowseAdminApi({
      "/tags/by-name?name=checkout": { status: 200, body: checkoutTag },
      "/tags/by-name?name=Web+team": { status: 200, body: webTeamTag },
      "/configs": {
        status: 200,
        body: createdConfig({
          tags: [
            { id: checkoutTag.id, name: checkoutTag.name },
            { id: webTeamTag.id, name: webTeamTag.name },
          ],
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--tag",
      "checkout",
      "--tag",
      "Web team",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created new-checkout in web-app: boolean, flag, temporary, client and server SDKs.",
      "Default targeting rule in every environment: false",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/tags/by-name?name=checkout")}`,
      `GET ${projectPath("/tags/by-name?name=Web+team")}`,
      `POST ${projectPath("/configs")}`,
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({ tagIds: [checkoutTag.id, webTeamTag.id] }),
    ]);
  });

  it("exits 2 naming the tag without creating the config when no tag has a --tag name", async () => {
    const adminApi = await startBrowseAdminApi({
      "/tags/by-name?name=checkout": { status: 200, body: checkoutTag },
      "/tags/by-name?name=chekout": { status: 404, body: {} },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--tag",
      "checkout",
      "--tag",
      "chekout",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No tag in web-app has the name "chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/tags/by-name?name=checkout")}`,
      `GET ${projectPath("/tags/by-name?name=chekout")}`,
    ]);
  });

  it("exits 1 with the summary of the config that has the key, read with a second request, when the key is taken", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 400, body: keyTakenErrors },
      "/configs/new-checkout": { status: 200, body: existingNewCheckout },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, featureFlagArguments);

    expect(exitCode).toEqual(1);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "web-app already has a config with the key new-checkout, so no config was created:",
      "new-checkout   boolean   flag   temporary   in-use",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `POST ${projectPath("/configs")}`,
      `GET ${projectPath("/configs/new-checkout")}`,
    ]);
  });

  it("prints the config that has the key as the second request received it with --json when the key is taken", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 400, body: keyTakenErrors },
      "/configs/new-checkout": {
        status: 200,
        body: { ...existingNewCheckout, addedByALaterApi: { reason: "kept" } },
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--json",
    ]);

    expect(exitCode).toEqual(1);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...existingNewCheckout, addedByALaterApi: { reason: "kept" } });
  });

  it("exits 2 listing the API's errors when the API rejects the key and no config has it", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 400,
        body: {
          errors: [
            {
              name: "key",
              message: "The key can only contain letters, numbers, periods, dashes, and underscores",
            },
          ],
        },
      },
      "/configs/new%20checkout": { status: 404, body: {} },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      "--key",
      "new checkout",
      "--type",
      "boolean",
      "--role",
      "flag",
      "--lifetime",
      "temporary",
      "--default-value",
      "false",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  key: The key can only contain letters, numbers, periods, dashes, and underscores\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `POST ${projectPath("/configs")}`,
      `GET ${projectPath("/configs/new%20checkout")}`,
    ]);
  });

  it("exits 2 listing the API's errors without a second request when the API rejects the request for another reason", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 400,
        body: { errors: [{ message: "The selected type is not available for the chosen config role" }] },
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      "--key",
      "checkout-banner",
      "--type",
      "string",
      "--role",
      "flag",
      "--lifetime",
      "temporary",
      "--default-value",
      "Free shipping today",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  The selected type is not available for the chosen config role\n",
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${projectPath("/configs")}`]);
  });

  it("prints the created config as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 200, body: createdConfig({ addedByALaterApi: { reason: "kept" } }) },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...featureFlagArguments,
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual(createdConfig({ addedByALaterApi: { reason: "kept" } }));
  });

  it("exits 2 naming the missing permission when the token cannot create configs", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 403,
        body: {
          error: "The API token is missing the `configs:create` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, featureFlagArguments);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API refused the request: The API token is missing the `configs:create` permission. (INSUFFICIENT_PERMISSIONS)\n",
    );
  });
});

describe("configs create type constraints", () => {
  it("sends an integer config's inclusive --min and --exclusive-max as bounds and its default targeting rule value as a number", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "max-cart-items",
          type: "integer",
          role: "config",
          lifetime: "permanent",
          typeOptions: {
            isInteger: true,
            min: { relation: ">=", value: 1 },
            max: { relation: "<", value: 100 },
          },
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("max-cart-items", "integer"),
      "--default-value",
      "20",
      "--min",
      "1",
      "--exclusive-max",
      "100",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created max-cart-items in web-app: integer, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: 20",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      {
        key: "max-cart-items",
        role: "config",
        lifetime: "permanent",
        type: "integer",
        typeOptions: {
          isInteger: true,
          min: { relation: ">=", value: 1 },
          max: { relation: "<", value: 100 },
        },
        client: true,
        server: true,
        variations: [],
        tagIds: [],
        defaultValue: 20,
      },
    ]);
  });

  it("sends a float config's --exclusive-min and inclusive --max as bounds and its default targeting rule value as a number", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "fraud-threshold",
          type: "float",
          role: "config",
          lifetime: "permanent",
          typeOptions: {
            isInteger: false,
            min: { relation: ">", value: 0 },
            max: { relation: "<=", value: 1 },
          },
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("fraud-threshold", "float"),
      "--default-value",
      "0.85",
      "--exclusive-min",
      "0",
      "--max",
      "1",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created fraud-threshold in web-app: float, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: 0.85",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        type: "float",
        typeOptions: {
          isInteger: false,
          min: { relation: ">", value: 0 },
          max: { relation: "<=", value: 1 },
        },
        defaultValue: 0.85,
      }),
    ]);
  });

  it("exits 2 without a request when --default-value does not parse as a number for a float config", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("fraud-threshold", "float"),
      "--default-value",
      "0,85",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --default-value takes a number with --type float, not 0,85.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --min is not a number", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("max-cart-items", "integer"),
      "--default-value",
      "20",
      "--min",
      "one",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --min takes a number, not one.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --min is combined with --exclusive-min", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("max-cart-items", "integer"),
      "--default-value",
      "20",
      "--min",
      "1",
      "--exclusive-min",
      "0",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("option '--exclusive-min <number>' cannot be used with option '--min <number>'");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("sends a timespan config's --unit, --min, --max and --allow-fractions and its default targeting rule value as a number", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "checkout-timeout",
          type: "timespan",
          role: "config",
          lifetime: "permanent",
          typeOptions: { unit: "seconds", min: 0, max: 3600, allowFractions: true },
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("checkout-timeout", "timespan"),
      "--default-value",
      "30",
      "--unit",
      "seconds",
      "--min",
      "0",
      "--max",
      "3600",
      "--allow-fractions",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created checkout-timeout in web-app: timespan, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: 30",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        type: "timespan",
        typeOptions: { unit: "seconds", min: 0, max: 3600, allowFractions: true },
        defaultValue: 30,
      }),
    ]);
  });

  it("exits 2 without a request when a timespan config is missing --max", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("checkout-timeout", "timespan"),
      "--default-value",
      "30",
      "--unit",
      "seconds",
      "--min",
      "0",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --type timespan needs --unit, --min and --max.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming the type when an option of another type is given", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("max-cart-items", "integer"),
      "--default-value",
      "20",
      "--unit",
      "seconds",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: --unit cannot be used with --type integer. It applies to --type timespan.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --exclusive-min is given for a timespan config, whose bounds are inclusive", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("checkout-timeout", "timespan"),
      "--default-value",
      "30",
      "--unit",
      "seconds",
      "--exclusive-min",
      "0",
      "--max",
      "3600",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: --exclusive-min cannot be used with --type timespan. It applies to --type integer or float.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("sends an enum config's --allowed-value values as strings and its default targeting rule value as text", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "theme",
          type: "enum",
          role: "config",
          lifetime: "permanent",
          typeOptions: { values: ["light", "dark", "system"], valueType: "string" },
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("theme", "enum"),
      "--default-value",
      "dark",
      "--allowed-value",
      "light",
      "--allowed-value",
      "dark",
      "--allowed-value",
      "system",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created theme in web-app: enum, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: dark",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        type: "enum",
        typeOptions: { values: ["light", "dark", "system"], valueType: "string" },
        defaultValue: "dark",
      }),
    ]);
  });

  it("sends an enum config's values as numbers with --enum-value-type number", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "page-size",
          type: "enum",
          role: "config",
          lifetime: "permanent",
          typeOptions: { values: ["10", "25", "50"], valueType: "number" },
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("page-size", "enum"),
      "--default-value",
      "25",
      "--allowed-value",
      "10",
      "--allowed-value",
      "25",
      "--allowed-value",
      "50",
      "--enum-value-type",
      "number",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created page-size in web-app: enum, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: 25",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        type: "enum",
        typeOptions: { values: ["10", "25", "50"], valueType: "number" },
        defaultValue: "25",
      }),
    ]);
  });

  it("sends secureOnly for a url config with --https-only and its default targeting rule value as text", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "support-url",
          type: "url",
          role: "config",
          lifetime: "permanent",
          typeOptions: { secureOnly: true },
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("support-url", "url"),
      "--default-value",
      "https://example.com/support",
      "--https-only",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created support-url in web-app: url, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: https://example.com/support",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        type: "url",
        typeOptions: { secureOnly: true },
        defaultValue: "https://example.com/support",
      }),
    ]);
  });

  it("sends secureOnly false for a url config without --https-only, since the API rejects empty url type options", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "support-url",
          type: "url",
          role: "config",
          lifetime: "permanent",
          typeOptions: { secureOnly: false },
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("support-url", "url"),
      "--default-value",
      "http://localhost:3000/support",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created support-url in web-app: url, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: http://localhost:3000/support",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        type: "url",
        typeOptions: { secureOnly: false },
        defaultValue: "http://localhost:3000/support",
      }),
    ]);
  });

  it("sends the JSON schema read from the --json-schema file for a json config and its default targeting rule value as JSON text", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "checkout-settings",
          type: "json",
          role: "config",
          lifetime: "permanent",
          typeOptions: { useSchema: true, schema: { type: "object", required: ["theme"] } },
        }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "schemas/checkout-settings.json",
      '{ "type": "object", "required": ["theme"] }\n',
    );

    const { exitCode, stdout, stderr } = await createConfigIn(sandbox, adminApi.baseUrl, [
      ...settingArguments("checkout-settings", "json"),
      "--default-value",
      '{ "theme": "dark" }',
      "--json-schema",
      "schemas/checkout-settings.json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created checkout-settings in web-app: json, config, permanent, client and server SDKs.",
      'Default targeting rule in every environment: { "theme": "dark" }',
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        type: "json",
        typeOptions: { useSchema: true, schema: { type: "object", required: ["theme"] } },
        defaultValue: '{ "theme": "dark" }',
      }),
    ]);
  });

  it("sends a json config's default targeting rule value read from the file named by --default-value @file without its surrounding whitespace, with no type options", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "checkout-settings",
          type: "json",
          role: "config",
          lifetime: "permanent",
        }),
      },
    });
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "values/checkout-settings.json",
      '{\n  "theme": "dark"\n}\n',
    );

    const { exitCode, stdout, stderr } = await createConfigIn(sandbox, adminApi.baseUrl, [
      ...settingArguments("checkout-settings", "json"),
      "--default-value",
      "@values/checkout-settings.json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created checkout-settings in web-app: json, config, permanent, client and server SDKs.",
      "Default targeting rule in every environment: {",
      '  "theme": "dark"',
      "}",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      {
        key: "checkout-settings",
        role: "config",
        lifetime: "permanent",
        type: "json",
        client: true,
        server: true,
        variations: [],
        tagIds: [],
        defaultValue: '{\n  "theme": "dark"\n}',
      },
    ]);
  });

  it("exits 2 without a request when --default-value is not JSON for a json config", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...settingArguments("checkout-settings", "json"),
      "--default-value",
      "{ theme: dark }",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: --default-value takes JSON or @<file> with --type json, not { theme: dark }.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming the file when --default-value @file does not exist", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await createConfigIn(sandbox, adminApi.baseUrl, [
      ...settingArguments("checkout-settings", "json"),
      "--default-value",
      "@values/missing.json",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      `Error: --default-value names ${join(sandbox.workingDirectory, "values/missing.json")}, which does not exist.\n`,
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when the --json-schema file is not JSON", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "schemas/checkout-settings.yaml", "type: object\n");

    const { exitCode, stdout, stderr } = await createConfigIn(sandbox, adminApi.baseUrl, [
      ...settingArguments("checkout-settings", "json"),
      "--default-value",
      '{ "theme": "dark" }',
      "--json-schema",
      "schemas/checkout-settings.yaml",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      `Error: --json-schema names ${join(sandbox.workingDirectory, "schemas/checkout-settings.yaml")}, which is not JSON.\n`,
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });
});

describe("configs create variations", () => {
  const experimentArguments = [
    "--key",
    "checkout-button-size",
    "--type",
    "integer",
    "--role",
    "experiment",
    "--lifetime",
    "temporary",
    "--default-value",
    "10",
  ];

  it("sends each --variation name=value pair as a variation with its value in the config's type", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: createdConfig({
          key: "checkout-button-size",
          type: "integer",
          role: "experiment",
          typeOptions: { isInteger: true },
          variations: [
            { name: "small", value: "10" },
            { name: "large", value: "20" },
          ],
        }),
      },
    });

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...experimentArguments,
      "--variation",
      "small=10",
      "--variation",
      "large=20",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created checkout-button-size in web-app: integer, experiment, temporary, client and server SDKs.",
      "Default targeting rule in every environment: 10",
      "",
    ]);
    expect(createRequestBodies(adminApi)).toEqual([
      expect.objectContaining({
        role: "experiment",
        variations: [
          { name: "small", value: 10 },
          { name: "large", value: 20 },
        ],
        defaultValue: 10,
      }),
    ]);
  });

  it("exits 2 without a request when a --variation has no name=value separator", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...experimentArguments,
      "--variation",
      "10",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --variation takes name=value, not 10.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when a --variation value does not parse in the config's type", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createConfig(adminApi.baseUrl, [
      ...experimentArguments,
      "--variation",
      "small=ten",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --variation small takes a number with --type integer, not ten.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
