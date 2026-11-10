import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment } from "./support/evaluate-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const updateMetric = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "metrics",
      "update",
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

const checkoutCompletedId = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const checkoutCompleted = {
  id: checkoutCompletedId,
  projectId: webApp.id,
  eventName: "checkout_completed",
  description: "Orders paid for.",
  direction: "higher-is-better",
  kinds: ["conversion"],
  usages: [],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const listedByEventName = "/metrics?eventName=checkout_completed";
const metricPath = `/metrics/${checkoutCompletedId}`;

describe("metrics update", () => {
  it("sends only the fields given to the metric the event name names, and prints a line saying so, then the metric as metrics get prints it", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: {
        status: 200,
        body: { ...checkoutCompleted, kinds: ["conversion", "value-per-context"] },
      },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--kind",
      "conversion",
      "--kind",
      "value-per-context",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Updated metric checkout_completed in web-app.",
      "checkout_completed",
      "  Description: Orders paid for.",
      "  Kinds: conversion, value per context",
      "  Direction: higher is better",
      "",
      "No experiment uses it.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath(listedByEventName)}`,
      `PATCH ${projectPath(metricPath)}`,
    ]);
    expect(adminApi.receivedRequests[2]?.body).toEqual({ kinds: ["conversion", "value-per-context"] });
  });

  it("sends the direction and the description when they are given", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 200, body: checkoutCompleted },
    });

    await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--direction",
      "lower-is-better",
      "--description",
      "Orders paid and shipped.",
    ]);

    expect(adminApi.receivedRequests[2]?.body).toEqual({
      direction: "lower-is-better",
      description: "Orders paid and shipped.",
    });
  });

  it('sends an empty description for --description "", which removes it', async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 200, body: { ...checkoutCompleted, description: null } },
    });

    const { stdout } = await updateMetric(adminApi.baseUrl, ["checkout_completed", "--description", ""]);

    expect(adminApi.receivedRequests[2]?.body).toEqual({ description: "" });
    expect(stdout.split("\n").slice(1, 4)).toEqual([
      "checkout_completed",
      "  Kinds: conversion",
      "  Direction: higher is better",
    ]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 200, body: { ...checkoutCompleted, addedByALaterApi: { reason: "kept" } } },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--direction",
      "higher-is-better",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...checkoutCompleted, addedByALaterApi: { reason: "kept" } });
  });

  it("exits 2 naming each experiment whose primary metric decides on a kind the change removes when the API refuses with METRIC_KIND_IN_USE", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: {
        status: 200,
        body: [{ ...checkoutCompleted, kinds: ["conversion", "value-per-context"] }],
      },
      [metricPath]: {
        status: 409,
        body: {
          error: "The primary metric of 2 experiments decides on a kind this change removes",
          code: "METRIC_KIND_IN_USE",
          usages: [
            {
              configKey: "checkout-cta-copy",
              role: "primary",
              primaryKind: "value-per-context",
              openRuns: [
                { id: "run", environmentId: productionEnvironment.id, startedAt: "2026-11-03T12:00:00.000Z" },
              ],
            },
            {
              configKey: "pricing-page-copy",
              role: "primary",
              primaryKind: "value-per-context",
              openRuns: [],
            },
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--kind",
      "conversion",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr.split("\n")).toEqual([
      "Error: 2 experiments decide on a kind this change removes, so checkout_completed was not updated:",
      "  checkout-cta-copy decides on value per context",
      "  pricing-page-copy decides on value per context",
      "Give each of them another primary kind first, on the experiment's Settings tab in the dashboard.",
      "",
    ]);
  });

  it("exits 2 saying no metric in the project has the event name, with no PATCH, when the project has none for it", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics?eventName=checkout_complete": { status: 200, body: [] },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_complete",
      "--direction",
      "lower-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_complete".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/metrics?eventName=checkout_complete")}`,
    ]);
  });

  it("exits 2 saying no metric in the project has the event name when the metric is gone by the time of the PATCH", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: {
        status: 404,
        body: {
          error: `No metric with id '${checkoutCompletedId}' exists in the project.`,
          code: "METRIC_NOT_FOUND",
        },
      },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--direction",
      "lower-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_completed".\n');
  });

  it("sends the change as JSON in a PATCH with the bearer token and the cli source client", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 200, body: checkoutCompleted },
    });

    await updateMetric(adminApi.baseUrl, ["checkout_completed", "--direction", "lower-is-better"]);

    const patchRequest = adminApi.receivedRequests.find((request) => request.method === "PATCH");
    expect({
      contentType: patchRequest?.headers["content-type"],
      authorization: patchRequest?.headers.authorization,
      sourceClient: patchRequest?.headers["x-sourceclient"],
    }).toEqual({
      contentType: "application/json",
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
    });
  });

  it("exits 2 saying no metric in the project has the event name when the API answers the PATCH with 404 and an empty body", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 404, body: {} },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--direction",
      "lower-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_completed".\n');
  });

  it("exits 2 reporting an unexpected response when the API answers 409 for another reason", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 409, body: { error: "The API token has expired", code: "API_TOKEN_EXPIRED" } },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--direction",
      "lower-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(`${projectPath(metricPath)} with HTTP 409.`);
  });

  it("exits 2 listing the API's errors when the API rejects the change", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: {
        status: 400,
        body: {
          errors: [
            { name: "description", message: "The description cannot be longer than 1,000 characters" },
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--description",
      "a".repeat(1001),
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  description: The description cannot be longer than 1,000 characters\n",
    );
  });

  it("exits 2 naming the missing permission when the token cannot update metrics", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: {
        status: 403,
        body: {
          error: "The API token is missing the `metrics:update` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--direction",
      "lower-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("metrics:update");
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
  });
});

describe("metrics update usage errors", () => {
  it("exits 2 without a request when no option says what to change", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: Say what to change with --kind, --direction or --description.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming the choices when --kind names no kind", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--kind",
      "revenue",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("Allowed choices are conversion, count-per-context, value-per-context.");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when the event name is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await updateMetric(adminApi.baseUrl, [
      "--direction",
      "lower-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("missing required argument 'event name'");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
