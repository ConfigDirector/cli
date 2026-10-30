import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import {
  checkoutTag,
  configNotFound,
  projectPath,
  requestLinesOf,
  startBrowseAdminApi,
  tagNotFound,
  webTeamTag,
} from "./support/browse-admin-api.js";
import { productionEnvironment, testEnvironment } from "./support/evaluate-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { projectConfig, webApp } from "./support/scan-admin-api.js";

const runConfigsCommand = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "configs",
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

const newCheckout = projectConfig("new-checkout");

const maxCartItems = projectConfig("max-cart-items", [], {
  type: "integer",
  role: "config",
  lifetime: "permanent",
  state: "settled",
});

const legacyBanner = projectConfig("legacy-banner", [], { state: "archive-ready" });

describe("configs list", () => {
  it("prints a header row, then one line per config with its key, type, role, lifetime and lifecycle state", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 200, body: [newCheckout, maxCartItems, legacyBanner] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "KEY              TYPE      ROLE     LIFETIME    STATE",
      "new-checkout     boolean   flag     temporary   in-use",
      "max-cart-items   integer   config   permanent   settled",
      "legacy-banner    boolean   flag     temporary   archive-ready",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/configs")}`]);
  });

  it("prints the config lines without the header row with --no-headers", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 200, body: [newCheckout, maxCartItems, legacyBanner] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["list", "--no-headers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout     boolean   flag     temporary   in-use",
      "max-cart-items   integer   config   permanent   settled",
      "legacy-banner    boolean   flag     temporary   archive-ready",
      "",
    ]);
  });

  it("resolves each --tag name to its tag and lists the configs that have any of those tags", async () => {
    const adminApi = await startBrowseAdminApi({
      "/tags/by-name?name=checkout": { status: 200, body: checkoutTag },
      "/tags/by-name?name=Web+team": { status: 200, body: webTeamTag },
      [`/configs?tagIds=${checkoutTag.id}&tagIds=${webTeamTag.id}`]: { status: 200, body: [newCheckout] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--tag",
      "checkout",
      "--tag",
      "Web team",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "KEY            TYPE      ROLE   LIFETIME    STATE",
      "new-checkout   boolean   flag   temporary   in-use",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/tags/by-name?name=checkout")}`,
      `GET ${projectPath("/tags/by-name?name=Web+team")}`,
      `GET ${projectPath(`/configs?tagIds=${checkoutTag.id}&tagIds=${webTeamTag.id}`)}`,
    ]);
  });

  it("exits 2 naming the tag without listing configs when the API answers 404 with an empty body for a --tag name", async () => {
    const adminApi = await startBrowseAdminApi({
      "/tags/by-name?name=checkout": { status: 200, body: checkoutTag },
      "/tags/by-name?name=chekout": { status: 404, body: {} },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
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

  it("exits 2 naming the tag without listing configs when the API answers 404 with TAG_NOT_FOUND for a --tag name", async () => {
    const adminApi = await startBrowseAdminApi({
      "/tags/by-name?name=chekout": tagNotFound("chekout"),
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--tag",
      "chekout",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No tag in web-app has the name "chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/tags/by-name?name=chekout")}`,
    ]);
  });

  it("sends untagged=true and lists the configs without tags for --untagged", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs?untagged=true": { status: 200, body: [maxCartItems] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["list", "--untagged"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "KEY              TYPE      ROLE     LIFETIME    STATE",
      "max-cart-items   integer   config   permanent   settled",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs?untagged=true")}`,
    ]);
  });

  it("exits 2 without a request when --tag is combined with --untagged", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--tag",
      "checkout",
      "--untagged",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("option '--untagged' cannot be used with option '--tag <name>'");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("lists only the configs in the lifecycle state given by --state", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": { status: 200, body: [newCheckout, maxCartItems, legacyBanner] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--state",
      "archive-ready",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "KEY             TYPE      ROLE   LIFETIME    STATE",
      "legacy-banner   boolean   flag   temporary   archive-ready",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/configs")}`]);
  });

  it("prints the configs in the --state lifecycle state as received with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: [newCheckout, { ...maxCartItems, addedByALaterApi: { reason: "kept" } }, legacyBanner],
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--state",
      "settled",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([{ ...maxCartItems, addedByALaterApi: { reason: "kept" } }]);
  });

  it("exits 2 without a request when --state is not a lifecycle state", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--state",
      "in use",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("Allowed choices are new, in-use, settled, archive-ready, stale");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: [newCheckout, { ...maxCartItems, addedByALaterApi: { reason: "kept" } }],
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["list", "--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([
      newCheckout,
      { ...maxCartItems, addedByALaterApi: { reason: "kept" } },
    ]);
  });

  it("prints the API's response as received and nothing else with --json and --no-headers", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 200,
        body: [newCheckout, { ...maxCartItems, addedByALaterApi: { reason: "kept" } }],
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--json",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([
      newCheckout,
      { ...maxCartItems, addedByALaterApi: { reason: "kept" } },
    ]);
  });

  it("says no configs were found when the listing is empty", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs?untagged=true": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["list", "--untagged"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No configs found in web-app.\n");
  });

  it("says no configs were found with --no-headers when the listing is empty", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs?untagged=true": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "list",
      "--untagged",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No configs found in web-app.\n");
  });

  it("exits 2 naming the missing permission when the token cannot read configs", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs": {
        status: 403,
        body: {
          error: "The API token is missing the `configs:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API refused the request: The API token is missing the `configs:read` permission. (INSUFFICIENT_PERMISSIONS)\n",
    );
  });
});

const targetEnvironmentOf = (environment: typeof productionEnvironment) => ({
  id: environment.id,
  name: environment.name,
  slug: environment.slug,
  color: environment.color,
  live: environment.live,
});

const targetingRulesIn = (
  environment: typeof productionEnvironment,
  rules: object[],
  defaultValue: string,
) => ({
  id: `target-${environment.slug}`,
  environment: targetEnvironmentOf(environment),
  rules,
  defaultValue,
  defaultValueId: `default-${environment.slug}`,
});

const planIsProOrTeam = {
  id: "rule-plan",
  type: "conditional",
  order: 0,
  conditions: [
    {
      id: "condition-plan",
      kind: "attribute",
      attribute: "traits",
      trait: "/plan",
      operator: "is one of",
      targetType: "text",
      targetValues: ["pro", "team"],
    },
  ],
  target: "value",
  value: true,
  percentages: [],
};

const rolloutToThirtyPercent = {
  id: "rule-rollout",
  type: "percentage",
  target: "percentage",
  order: 1,
  percentages: [
    { id: "share-true", percentage: 30, value: true },
    { id: "share-false", percentage: 70, value: false },
  ],
};

const betaTestersSegmentId = "8c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";

const inBetaTesters = {
  id: "rule-beta",
  type: "conditional",
  order: 2,
  conditions: [{ id: "condition-beta", kind: "segment", operator: "in", segmentId: betaTestersSegmentId }],
  target: "value",
  value: true,
  percentages: [],
};

const betaTestersSegment = {
  id: betaTestersSegmentId,
  projectId: webApp.id,
  key: "beta-testers",
  name: "Beta testers",
  kind: "rule-based",
  groups: [
    [
      {
        id: "condition-email",
        kind: "attribute",
        attribute: "traits",
        trait: "/email",
        operator: "ends with any of",
        targetType: "text",
        targetValues: ["@example.com"],
      },
    ],
  ],
  overrides: {},
  usages: [{ configKey: "new-checkout", environmentIds: [productionEnvironment.id] }],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const configWithTargetingRules = (overrides: object = {}) => ({
  ...projectConfig("new-checkout"),
  description: "Shows the new checkout flow",
  tags: [
    { id: checkoutTag.id, name: checkoutTag.name },
    { id: webTeamTag.id, name: webTeamTag.name },
  ],
  settledValue: null,
  variations: [],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  targets: [
    targetingRulesIn(testEnvironment, [], "false"),
    targetingRulesIn(
      productionEnvironment,
      [planIsProOrTeam, rolloutToThirtyPercent, inBetaTesters],
      "false",
    ),
  ],
  ...overrides,
});

describe("configs get", () => {
  it("prints the config's settings, then each environment's targeting rules with its default targeting rule value last", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": { status: 200, body: configWithTargetingRules() },
      "/segments": { status: 200, body: [betaTestersSegment] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout",
      "  Description: Shows the new checkout flow",
      "  Type: boolean",
      "  Role: flag",
      "  Lifetime: temporary",
      "  Availability: client and server SDKs",
      "  Lifecycle state: in-use",
      "  Tags: checkout, Web team",
      "",
      "test",
      "  Default targeting rule: false",
      "",
      "production (live)",
      "  1. plan is one of pro, team: true",
      "  2. 30% get true, 70% get false",
      "  3. in segment Beta testers: true",
      "  Default targeting rule: false",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs/new-checkout")}`,
      `GET ${projectPath("/segments")}`,
    ]);
  });

  it("names a segment by its id when the token cannot read segments", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": { status: 200, body: configWithTargetingRules() },
      "/segments": {
        status: 403,
        body: {
          error: "The API token is missing the `segments:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toContain(`  3. in segment ${betaTestersSegmentId}: true`);
  });

  it("says the key given is an old key of the config's current key before the config", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/checkout-v2": {
        status: 200,
        body: configWithTargetingRules({
          deprecatedKeys: [
            { id: "key-checkout-v2", configId: "config-new-checkout", key: "checkout-v2", isPrimary: false },
          ],
        }),
      },
      "/segments": { status: 200, body: [betaTestersSegment] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "checkout-v2"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "checkout-v2 is an old key of new-checkout.",
      "new-checkout",
    ]);
  });

  it("exits 2 saying no config in the project has the key when the API answers 404 with an empty body", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs/new-chekout": { status: 404, body: {} } });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-chekout"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs/new-chekout")}`,
    ]);
  });

  it("exits 2 saying no config in the project has the key when the API answers 404 with CONFIG_NOT_FOUND", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs/new-chekout": configNotFound("new-chekout") });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-chekout"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs/new-chekout")}`,
    ]);
  });

  it("exits 2 showing the status when a 404 comes with a body that is not JSON", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": { status: 404, rawBody: "<html>Not Found</html>" },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("HTTP 404");
  });

  it("exits 2 showing the status when a 404 carries a code that does not name a missing resource", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": {
        status: 404,
        body: { error: "The route is not available on this server.", code: "ROUTE_UNAVAILABLE" },
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("HTTP 404");
  });

  it("requests no segment listing when no targeting rule has a segment condition", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": {
        status: 200,
        body: configWithTargetingRules({
          targets: [targetingRulesIn(productionEnvironment, [planIsProOrTeam], "false")],
        }),
      },
    });

    const { exitCode, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs/new-checkout")}`,
    ]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": {
        status: 200,
        body: configWithTargetingRules({ addedByALaterApi: { reason: "kept" } }),
      },
      "/segments": { status: 200, body: [betaTestersSegment] },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "get",
      "new-checkout",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual(configWithTargetingRules({ addedByALaterApi: { reason: "kept" } }));
  });

  it("leaves out the description and tags a config does not have and says a server-only config is server-only", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": {
        status: 200,
        body: configWithTargetingRules({ description: null, tags: [], client: false, targets: [] }),
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout",
      "  Type: boolean",
      "  Role: flag",
      "  Lifetime: temporary",
      "  Availability: server-only",
      "  Lifecycle state: in-use",
      "",
    ]);
  });

  it("says a client-only config is client-only", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": {
        status: 200,
        body: configWithTargetingRules({ server: false, targets: [] }),
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toContain("  Availability: client-only");
  });
});

const configTypeLine = async (typeSettings: { type: string; typeOptions: object | null }) => {
  const adminApi = await startBrowseAdminApi({
    "/configs/new-checkout": {
      status: 200,
      body: configWithTargetingRules({ ...typeSettings, role: "config", lifetime: "permanent", targets: [] }),
    },
  });

  const { stdout } = await runConfigsCommand(adminApi.baseUrl, ["get", "new-checkout"]);

  return stdout.split("\n").find((line) => line.startsWith("  Type: "));
};

describe("configs get type constraints", () => {
  it("shows the bounds of a number config", async () => {
    const typeLine = await configTypeLine({
      type: "integer",
      typeOptions: { isInteger: true, min: { relation: ">=", value: 1 }, max: { relation: "<", value: 100 } },
    });

    expect(typeLine).toEqual("  Type: integer, >= 1 and < 100");
  });

  it("shows the allowed values of an enum config", async () => {
    const typeLine = await configTypeLine({
      type: "enum",
      typeOptions: { valueType: "string", values: ["light", "dark", "system"] },
    });

    expect(typeLine).toEqual("  Type: enum, one of light, dark, system");
  });

  it("says the allowed values of an enum config are numbers when they are", async () => {
    const typeLine = await configTypeLine({
      type: "enum",
      typeOptions: { valueType: "number", values: ["10", "25", "50"] },
    });

    expect(typeLine).toEqual("  Type: enum, one of the numbers 10, 25, 50");
  });

  it("shows the range and unit of a timespan config in whole units", async () => {
    const typeLine = await configTypeLine({
      type: "timespan",
      typeOptions: { unit: "seconds", allowFractions: false, min: 0, max: 3600 },
    });

    expect(typeLine).toEqual("  Type: timespan, 0 to 3600 seconds");
  });

  it("says a timespan config allows fractions of its unit when it does", async () => {
    const typeLine = await configTypeLine({
      type: "timespan",
      typeOptions: { unit: "minutes", allowFractions: true, min: 1, max: 90 },
    });

    expect(typeLine).toEqual("  Type: timespan, 1 to 90 minutes, fractions allowed");
  });

  it("says a URL config takes only HTTPS URLs when it does", async () => {
    const typeLine = await configTypeLine({ type: "url", typeOptions: { secureOnly: true } });

    expect(typeLine).toEqual("  Type: url, HTTPS only");
  });

  it("says a JSON config is checked against a JSON schema when it is", async () => {
    const typeLine = await configTypeLine({
      type: "json",
      typeOptions: { useSchema: true, schema: { type: "object", required: ["theme"] } },
    });

    expect(typeLine).toEqual("  Type: json, checked against a JSON schema");
  });

  it("shows the name of a type the CLI does not know, such as one the API adds later", async () => {
    const typeLine = await configTypeLine({ type: "date", typeOptions: { earliest: "2026-01-01" } });

    expect(typeLine).toEqual("  Type: date");
  });
});

const latestEvaluationIn = (
  environment: typeof productionEnvironment,
  evaluation: { source: string; sdkName: string | null; sdkVersion: string | null; time: string },
) => ({ environmentId: environment.id, environment: targetEnvironmentOf(environment), ...evaluation });

describe("configs activity", () => {
  it("prints a header row, then one line per latest evaluation with the environment slug, SDK key kind, SDK and time in UTC", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout/activity": {
        status: 200,
        body: {
          latestEvaluations: [
            latestEvaluationIn(productionEnvironment, {
              source: "server",
              sdkName: "js-server",
              sdkVersion: "1.4.0",
              time: "2026-10-17T14:03:27.512Z",
            }),
            latestEvaluationIn(testEnvironment, {
              source: "client",
              sdkName: "react",
              sdkVersion: "2.1.0",
              time: "2026-10-16T09:12:05.000Z",
            }),
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-checkout",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "ENVIRONMENT   SDK KEY   SDK               LAST EVALUATED",
      "production    server    js-server 1.4.0   2026-10-17 14:03 UTC",
      "test          client    react 2.1.0       2026-10-16 09:12 UTC",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs/new-checkout/activity")}`,
    ]);
  });

  it("prints the latest evaluation lines without the header row with --no-headers", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout/activity": {
        status: 200,
        body: {
          latestEvaluations: [
            latestEvaluationIn(productionEnvironment, {
              source: "server",
              sdkName: "js-server",
              sdkVersion: "1.4.0",
              time: "2026-10-17T14:03:27.512Z",
            }),
            latestEvaluationIn(testEnvironment, {
              source: "client",
              sdkName: "react",
              sdkVersion: "2.1.0",
              time: "2026-10-16T09:12:05.000Z",
            }),
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-checkout",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "production   server   js-server 1.4.0   2026-10-17 14:03 UTC",
      "test         client   react 2.1.0       2026-10-16 09:12 UTC",
      "",
    ]);
  });

  it("says no evaluations were found when no SDK has evaluated the config", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout/activity": { status: 200, body: { latestEvaluations: [] } },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-checkout",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No SDK evaluations of new-checkout found.\n");
  });

  it("says no evaluations were found with --no-headers when no SDK has evaluated the config", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout/activity": { status: 200, body: { latestEvaluations: [] } },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-checkout",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No SDK evaluations of new-checkout found.\n");
  });

  it("calls an SDK that did not report its name and version an unknown SDK", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout/activity": {
        status: 200,
        body: {
          latestEvaluations: [
            latestEvaluationIn(productionEnvironment, {
              source: "server",
              sdkName: null,
              sdkVersion: null,
              time: "2026-10-15T23:59:59.999Z",
            }),
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-checkout",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "ENVIRONMENT   SDK KEY   SDK           LAST EVALUATED",
      "production    server    unknown SDK   2026-10-15 23:59 UTC",
      "",
    ]);
  });

  it("exits 2 saying no config in the project has the key when the API answers 404 with an empty body", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-chekout/activity": { status: 404, body: {} },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-chekout",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs/new-chekout/activity")}`,
    ]);
  });

  it("exits 2 saying no config in the project has the key when the API answers 404 with CONFIG_NOT_FOUND", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-chekout/activity": configNotFound("new-chekout"),
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-chekout",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/configs/new-chekout/activity")}`,
    ]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const activity = {
      latestEvaluations: [
        {
          ...latestEvaluationIn(testEnvironment, {
            source: "client",
            sdkName: "react",
            sdkVersion: "2.1.0",
            time: "2026-10-16T09:12:05.000Z",
          }),
          addedByALaterApi: { reason: "kept" },
        },
      ],
    };
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout/activity": { status: 200, body: activity },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-checkout",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual(activity);
  });

  it("prints the API's response as received and nothing else with --json and --no-headers", async () => {
    const activity = {
      latestEvaluations: [
        {
          ...latestEvaluationIn(testEnvironment, {
            source: "client",
            sdkName: "react",
            sdkVersion: "2.1.0",
            time: "2026-10-16T09:12:05.000Z",
          }),
          addedByALaterApi: { reason: "kept" },
        },
      ],
    };
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout/activity": { status: 200, body: activity },
    });

    const { exitCode, stdout, stderr } = await runConfigsCommand(adminApi.baseUrl, [
      "activity",
      "new-checkout",
      "--json",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual(activity);
  });
});
