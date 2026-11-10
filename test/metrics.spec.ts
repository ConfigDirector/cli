import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment, testEnvironment } from "./support/evaluate-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const runMetricsCommand = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "metrics",
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

const metricOf = (overrides: object) => ({
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  projectId: webApp.id,
  eventName: "checkout_completed",
  description: null,
  direction: "higher-is-better",
  kinds: ["conversion"],
  usages: [],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

const checkoutCompleted = metricOf({
  kinds: ["conversion", "value-per-context"],
  usages: [
    { configKey: "checkout-cta-copy", role: "primary", primaryKind: "conversion", openRuns: [] },
    { configKey: "pricing-page-copy", role: "secondary", primaryKind: null, openRuns: [] },
  ],
});

const supportTicketOpened = metricOf({
  id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
  eventName: "support_ticket_opened",
  direction: "lower-is-better",
  kinds: ["count-per-context"],
  usages: [{ configKey: "checkout-cta-copy", role: "guardrail", primaryKind: null, openRuns: [] }],
});

const searchUsed = metricOf({
  id: "3e4f5a6b-7c8d-4e9f-8a0b-2c3d4e5f6a7b",
  eventName: "search_used",
});

describe("metrics list", () => {
  it("prints a header row, then one line per metric with its event name, kinds, direction and how many experiments use it", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: [checkoutCompleted, searchUsed, supportTicketOpened] },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "EVENT NAME              KINDS                           DIRECTION          USED BY",
      "checkout_completed      conversion, value per context   higher is better   used by 2 experiments",
      "search_used             conversion                      higher is better   used by 0 experiments",
      "support_ticket_opened   count per context               lower is better    used by 1 experiment",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/metrics")}`]);
  });

  it("prints the metric lines without the header row with --no-headers", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: [checkoutCompleted, searchUsed] },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, ["list", "--no-headers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "checkout_completed   conversion, value per context   higher is better   used by 2 experiments",
      "search_used          conversion                      higher is better   used by 0 experiments",
      "",
    ]);
  });

  it("says no metrics were found when the project has none", async () => {
    const adminApi = await startBrowseAdminApi({ "/metrics": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No metrics found in web-app.\n");
  });

  it("writes a kind and a direction the CLI does not know by their names", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: [metricOf({ kinds: ["ratio"], direction: "closer-to-target" })] },
    });

    const { stdout } = await runMetricsCommand(adminApi.baseUrl, ["list", "--no-headers"]);

    expect(stdout.split("\n")[0]).toEqual(
      "checkout_completed   ratio   closer-to-target   used by 0 experiments",
    );
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: [{ ...checkoutCompleted, addedByALaterApi: { reason: "kept" } }] },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, ["list", "--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([{ ...checkoutCompleted, addedByALaterApi: { reason: "kept" } }]);
  });
});

const metricsNamed = (eventName: string) => `/metrics?${new URLSearchParams({ eventName })}`;

const checkoutCompletedInUse = metricOf({
  description: "Orders paid for.",
  kinds: ["conversion", "value-per-context"],
  usages: [
    {
      configKey: "checkout-cta-copy",
      role: "primary",
      primaryKind: "conversion",
      openRuns: [
        {
          id: "run-production",
          environmentId: productionEnvironment.id,
          startedAt: "2026-11-03T12:00:00.000Z",
        },
        { id: "run-test", environmentId: testEnvironment.id, startedAt: "2026-11-02T12:00:00.000Z" },
      ],
    },
    { configKey: "pricing-page-copy", role: "guardrail", primaryKind: null, openRuns: [] },
  ],
});

describe("metrics get", () => {
  it("prints the metric's event name, description, kinds and direction, and each experiment using it with its role and the environments of its open runs", async () => {
    const adminApi = await startBrowseAdminApi({
      [metricsNamed("checkout_completed")]: { status: 200, body: [checkoutCompletedInUse] },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, [
      "get",
      "checkout_completed",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "checkout_completed",
      "  Description: Orders paid for.",
      "  Kinds: conversion, value per context",
      "  Direction: higher is better",
      "",
      "Used by",
      "  checkout-cta-copy: primary metric on conversion, running in production, test",
      "  pricing-page-copy: guardrail",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath(metricsNamed("checkout_completed"))}`,
      `GET ${projectPath("/environments")}`,
    ]);
  });

  it("says no experiment uses a metric no experiment is attached to, and requests no environment listing", async () => {
    const adminApi = await startBrowseAdminApi({
      [metricsNamed("search_used")]: { status: 200, body: [searchUsed] },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, ["get", "search_used"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "search_used",
      "  Kinds: conversion",
      "  Direction: higher is better",
      "",
      "No experiment uses it.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath(metricsNamed("search_used"))}`,
    ]);
  });

  it("names an open run's environment by its id when the token cannot read environments", async () => {
    const adminApi = await startBrowseAdminApi({
      [metricsNamed("checkout_completed")]: { status: 200, body: [checkoutCompletedInUse] },
      "/environments": {
        status: 403,
        body: {
          error: "The API token is missing the `environments:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, [
      "get",
      "checkout_completed",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toContain(
      `  checkout-cta-copy: primary metric on conversion, running in ${productionEnvironment.id}, ${testEnvironment.id}`,
    );
  });

  it("finds a metric whose event name holds spaces and an ampersand", async () => {
    const adminApi = await startBrowseAdminApi({
      [metricsNamed("Order Paid & Shipped")]: {
        status: 200,
        body: [metricOf({ eventName: "Order Paid & Shipped" })],
      },
    });

    const { exitCode, stdout } = await runMetricsCommand(adminApi.baseUrl, ["get", "Order Paid & Shipped"]);

    expect(exitCode).toEqual(0);
    expect(stdout.split("\n")[0]).toEqual("Order Paid & Shipped");
  });

  it("exits 2 saying no metric in the project has the event name when the project has none for it", async () => {
    const adminApi = await startBrowseAdminApi({
      [metricsNamed("checkout_complete")]: { status: 200, body: [] },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, [
      "get",
      "checkout_complete",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_complete".\n');
  });

  it("exits 2 saying no metric in the project has the event name when the API lists another event name", async () => {
    const adminApi = await startBrowseAdminApi({
      [metricsNamed("checkout_completed")]: { status: 200, body: [searchUsed] },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, [
      "get",
      "checkout_completed",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_completed".\n');
  });

  it("prints the metric as the API listed it, and nothing else, with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      [metricsNamed("checkout_completed")]: {
        status: 200,
        body: [{ ...checkoutCompletedInUse, addedByALaterApi: { reason: "kept" } }],
      },
    });

    const { exitCode, stdout, stderr } = await runMetricsCommand(adminApi.baseUrl, [
      "get",
      "checkout_completed",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...checkoutCompletedInUse, addedByALaterApi: { reason: "kept" } });
  });
});
