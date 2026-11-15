import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const createMetricIn = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[],
  stdin?: Readable,
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "metrics",
      "create",
      ...commandLineArguments,
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
    stdin,
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const createMetric = async (baseUrl: string, commandLineArguments: string[]) =>
  createMetricIn(await createSandbox(), baseUrl, commandLineArguments);

const createdCheckoutCompleted = {
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  projectId: webApp.id,
  eventName: "checkout_completed",
  filter: null,
  valueField: null,
  ratio: null,
  funnel: null,
  retention: null,
  description: "Orders paid for.",
  direction: "higher-is-better",
  kinds: ["conversion", "value-per-context"],
  usages: [],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const teamPlanFilter = [
  { field: "/plan", targetType: "text", operator: "is one of", targetValues: ["team"] },
];

const createdTeamItemsBought = {
  ...createdCheckoutCompleted,
  id: "4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c",
  filter: teamPlanFilter,
  valueField: "/items",
  description: null,
  kinds: ["value-per-context"],
};

const teamItemsBoughtOptions = [
  "--event-name",
  "checkout_completed",
  "--kind",
  "value-per-context",
  "--direction",
  "higher-is-better",
];

const checkoutCompletedOptions = [
  "--event-name",
  "checkout_completed",
  "--kind",
  "conversion",
  "--kind",
  "value-per-context",
  "--direction",
  "higher-is-better",
  "--description",
  "Orders paid for.",
];

const revenuePerOrderRatio = {
  numerator: { eventName: "order_completed", adds: "value" },
  denominator: { eventName: "order_completed", adds: "events" },
};

const createdRevenuePerOrder = {
  ...createdCheckoutCompleted,
  id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  eventName: null,
  ratio: {
    numerator: { ...revenuePerOrderRatio.numerator, filter: null, valueField: null },
    denominator: { ...revenuePerOrderRatio.denominator, filter: null, valueField: null },
  },
  description: null,
  kinds: ["ratio"],
};

const cartToPurchaseFunnel = {
  steps: [
    { eventName: "cart_viewed" },
    { eventName: "checkout_started" },
    { eventName: "checkout_completed" },
  ],
};

const createdCartToPurchase = {
  ...createdCheckoutCompleted,
  id: "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
  eventName: null,
  funnel: { steps: cartToPurchaseFunnel.steps.map((step) => ({ ...step, filter: null })) },
  description: null,
  kinds: ["funnel"],
};

const secondWeekRetention = { eventName: "app_opened", firstDay: 7, lastDay: 13 };

const createdSecondWeekReturns = {
  ...createdCheckoutCompleted,
  id: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  eventName: null,
  retention: { ...secondWeekRetention, filter: null },
  description: null,
  kinds: ["retention"],
};

const createDefinedMetric = async (
  baseUrl: string,
  file: { name: string; contents: object },
  commandLineArguments: string[],
) => {
  const sandbox = await createSandbox();
  await writeRepositoryFile(sandbox.workingDirectory, file.name, JSON.stringify(file.contents, null, 2));

  return createMetricIn(sandbox, baseUrl, commandLineArguments);
};

describe("metrics create", () => {
  it("sends the metric to create and prints a line saying so, then the metric as metrics get prints it", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: createdCheckoutCompleted },
    });

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, checkoutCompletedOptions);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created metric checkout_completed in web-app.",
      "checkout_completed",
      "  Description: Orders paid for.",
      "  Kinds: conversion, value per context",
      "  Direction: higher is better",
      "",
      "No experiment uses it.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${projectPath("/metrics")}`]);
    expect(adminApi.receivedRequests[1]?.body).toEqual({
      eventName: "checkout_completed",
      kinds: ["conversion", "value-per-context"],
      direction: "higher-is-better",
      description: "Orders paid for.",
    });
  });

  it("sends no description when --description is left out", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: { ...createdCheckoutCompleted, description: null } },
    });

    await createMetric(adminApi.baseUrl, [
      "--event-name",
      "checkout_completed",
      "--kind",
      "conversion",
      "--direction",
      "higher-is-better",
    ]);

    expect(adminApi.receivedRequests[1]?.body).toEqual({
      eventName: "checkout_completed",
      kinds: ["conversion"],
      direction: "higher-is-better",
    });
  });

  it("sends the filter the --filter file holds and the value field, and names the created metric by its event name, its filter and its value field", async () => {
    const adminApi = await startBrowseAdminApi({ "/metrics": { status: 200, body: createdTeamItemsBought } });
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "filter.json",
      JSON.stringify(teamPlanFilter, null, 2),
    );

    const { exitCode, stdout, stderr } = await createMetricIn(sandbox, adminApi.baseUrl, [
      ...teamItemsBoughtOptions,
      "--filter",
      "filter.json",
      "--value-field",
      "/items",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")[0]).toEqual(
      "Created metric checkout_completed · /plan is one of [team] · value from /items in web-app.",
    );
    expect(adminApi.receivedRequests[1]?.body).toEqual({
      eventName: "checkout_completed",
      filter: teamPlanFilter,
      valueField: "/items",
      kinds: ["value-per-context"],
      direction: "higher-is-better",
    });
  });

  it("reads the filter from stdin for --filter -", async () => {
    const adminApi = await startBrowseAdminApi({ "/metrics": { status: 200, body: createdTeamItemsBought } });
    const filterJson = JSON.stringify(teamPlanFilter);
    const stdin = Readable.from([filterJson.slice(0, 20), filterJson.slice(20)]);

    const { exitCode, stderr } = await createMetricIn(
      await createSandbox(),
      adminApi.baseUrl,
      [...teamItemsBoughtOptions, "--filter", "-", "--value-field", "/items"],
      stdin,
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(adminApi.receivedRequests[1]?.body).toEqual(expect.objectContaining({ filter: teamPlanFilter }));
  });

  it("sends the ratio the --ratio file holds with the ratio kind, and names the created metric kind first", async () => {
    const adminApi = await startBrowseAdminApi({ "/metrics": { status: 200, body: createdRevenuePerOrder } });

    const { exitCode, stdout, stderr } = await createDefinedMetric(
      adminApi.baseUrl,
      { name: "revenue-per-order.json", contents: revenuePerOrderRatio },
      ["--ratio", "revenue-per-order.json", "--direction", "higher-is-better"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created metric Ratio: order_completed value ÷ order_completed events in web-app.",
      "Ratio: order_completed value ÷ order_completed events",
      "  Kinds: ratio",
      "  Direction: higher is better",
      "",
      "No experiment uses it.",
      "",
    ]);
    expect(adminApi.receivedRequests[1]?.body).toEqual({
      ratio: revenuePerOrderRatio,
      kinds: ["ratio"],
      direction: "higher-is-better",
    });
  });

  it("sends the funnel the --funnel file holds with the funnel kind and the description", async () => {
    const adminApi = await startBrowseAdminApi({ "/metrics": { status: 200, body: createdCartToPurchase } });

    const { exitCode, stdout, stderr } = await createDefinedMetric(
      adminApi.baseUrl,
      { name: "cart-to-purchase.json", contents: cartToPurchaseFunnel },
      [
        "--funnel",
        "cart-to-purchase.json",
        "--direction",
        "higher-is-better",
        "--description",
        "From the cart to a purchase.",
      ],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")[0]).toEqual(
      "Created metric Funnel: cart_viewed → checkout_started → checkout_completed in web-app.",
    );
    expect(adminApi.receivedRequests[1]?.body).toEqual({
      funnel: cartToPurchaseFunnel,
      kinds: ["funnel"],
      direction: "higher-is-better",
      description: "From the cart to a purchase.",
    });
  });

  it("sends the retention the --retention file holds with the retention kind", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: createdSecondWeekReturns },
    });

    const { exitCode, stdout, stderr } = await createDefinedMetric(
      adminApi.baseUrl,
      { name: "second-week.json", contents: secondWeekRetention },
      ["--retention", "second-week.json", "--direction", "higher-is-better"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")[0]).toEqual("Created metric Retention: app_opened · days 7 to 13 in web-app.");
    expect(adminApi.receivedRequests[1]?.body).toEqual({
      retention: secondWeekRetention,
      kinds: ["retention"],
      direction: "higher-is-better",
    });
  });

  it("reads the retention from stdin for --retention -", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": { status: 200, body: createdSecondWeekReturns },
    });

    const { exitCode, stderr } = await createMetricIn(
      await createSandbox(),
      adminApi.baseUrl,
      ["--retention", "-", "--direction", "higher-is-better"],
      Readable.from([JSON.stringify(secondWeekRetention)]),
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(adminApi.receivedRequests[1]?.body).toEqual(
      expect.objectContaining({ retention: secondWeekRetention }),
    );
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": {
        status: 200,
        body: { ...createdCheckoutCompleted, addedByALaterApi: { reason: "kept" } },
      },
    });

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, [
      ...checkoutCompletedOptions,
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...createdCheckoutCompleted, addedByALaterApi: { reason: "kept" } });
  });

  it("exits 2 listing the API's errors when the API refuses the metric, as it refuses one with the same event name, filter and value field as another", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": {
        status: 400,
        body: {
          errors: [
            {
              name: "eventName",
              message: "The project already has a metric with this event name, filter and value field.",
            },
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, checkoutCompletedOptions);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  eventName: The project already has a metric with this event name, filter and value field.\n",
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${projectPath("/metrics")}`]);
  });

  it("exits 2 naming the missing permission when the token cannot create metrics", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": {
        status: 403,
        body: {
          error: "The API token is missing the `metrics:create` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, checkoutCompletedOptions);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("metrics:create");
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
  });
});

describe("metrics create usage errors", () => {
  it("exits 2 without a request naming the file when the --filter file does not hold a JSON array", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "filter.json",
      JSON.stringify(createdTeamItemsBought),
    );

    const { exitCode, stdout, stderr } = await createMetricIn(sandbox, adminApi.baseUrl, [
      ...teamItemsBoughtOptions,
      "--filter",
      "filter.json",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(
      `--filter names ${join(sandbox.workingDirectory, "filter.json")}, which does not hold a JSON array.`,
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when none of --event-name, --ratio, --funnel and --retention is given", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, [
      "--kind",
      "conversion",
      "--direction",
      "higher-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: Say what the metric measures with --event-name, --ratio, --funnel or --retention.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when both --event-name and --funnel are given", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createDefinedMetric(
      adminApi.baseUrl,
      { name: "cart-to-purchase.json", contents: cartToPurchaseFunnel },
      [...checkoutCompletedOptions, "--funnel", "cart-to-purchase.json"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: Give only one of --event-name, --ratio, --funnel and --retention.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming --kind and --filter when they are given with --ratio", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createDefinedMetric(
      adminApi.baseUrl,
      { name: "revenue-per-order.json", contents: revenuePerOrderRatio },
      [
        "--ratio",
        "revenue-per-order.json",
        "--kind",
        "value-per-context",
        "--filter",
        "revenue-per-order.json",
        "--direction",
        "higher-is-better",
      ],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: --kind and --filter do not apply with --ratio: the --ratio file holds the whole definition, " +
        "and a ratio metric reports the ratio kind alone.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming --value-field when it is given with --retention", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createDefinedMetric(
      adminApi.baseUrl,
      { name: "second-week.json", contents: secondWeekRetention },
      ["--retention", "second-week.json", "--value-field", "/items", "--direction", "higher-is-better"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: --value-field does not apply with --retention: the --retention file holds the whole definition, " +
        "and a retention metric reports the retention kind alone.\n",
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming the file when the --retention file does not hold a JSON object", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "second-week.json",
      JSON.stringify([secondWeekRetention]),
    );

    const { exitCode, stdout, stderr } = await createMetricIn(sandbox, adminApi.baseUrl, [
      "--retention",
      "second-week.json",
      "--direction",
      "higher-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(
      `--retention names ${join(sandbox.workingDirectory, "second-week.json")}, which does not hold a JSON object.`,
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --event-name is given without --kind", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, [
      "--event-name",
      "checkout_completed",
      "--direction",
      "higher-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --event-name needs at least one --kind.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming the choices when --kind names no kind", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, [
      "--event-name",
      "checkout_completed",
      "--kind",
      "conversion",
      "--kind",
      "revenue",
      "--direction",
      "higher-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("Allowed choices are conversion, count-per-context, value-per-context.");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --direction is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, [
      "--event-name",
      "checkout_completed",
      "--kind",
      "conversion",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--direction <direction>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
