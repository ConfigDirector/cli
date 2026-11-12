import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment, testEnvironment } from "./support/evaluate-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const deleteMetric = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "metrics",
      "delete",
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
  filter: null,
  valueField: null,
  description: null,
  direction: "higher-is-better",
  kinds: ["conversion"],
  usages: [],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const listedByEventName = "/metrics?eventName=checkout_completed";
const metricPath = `/metrics/${checkoutCompletedId}`;

const teamCheckoutCompletedId = "4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c";

const teamCheckoutCompleted = {
  ...checkoutCompleted,
  id: teamCheckoutCompletedId,
  filter: [{ field: "/plan", targetType: "text", operator: "is one of", targetValues: ["team"] }],
};

const teamMetricPath = `/metrics/${teamCheckoutCompletedId}`;

const metricInUse = {
  status: 409,
  body: {
    error: "The metric is attached to 1 experiment with an open run",
    code: "METRIC_IN_USE",
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
    ],
  },
};

describe("metrics delete", () => {
  it("deletes the metric the event name names and prints a line saying so", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 204 },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual(["Deleted metric checkout_completed from web-app.", ""]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath(listedByEventName)}`,
      `DELETE ${projectPath(metricPath)}`,
    ]);
  });

  it("prints the deleted metric's id and event name, and nothing else, with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 204 },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, [
      "checkout_completed",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({
      deletedMetricId: checkoutCompletedId,
      deletedEventName: "checkout_completed",
    });
  });

  it("exits 2 listing each metric with the event name by its id and its name, with no DELETE, when several share it", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted, teamCheckoutCompleted] },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr.split("\n")).toEqual([
      'Error: 2 metrics in web-app have the event name "checkout_completed". Name one with --id:',
      `  ${checkoutCompletedId}   checkout_completed`,
      `  ${teamCheckoutCompletedId}   checkout_completed · /plan is one of [team]`,
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath(listedByEventName)}`]);
  });

  it("deletes the metric --id names and prints a line naming it by its event name and its filter", async () => {
    const adminApi = await startBrowseAdminApi({
      [teamMetricPath]: (request) =>
        request.method === "GET" ? { status: 200, body: teamCheckoutCompleted } : { status: 204 },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, [
      "--id",
      teamCheckoutCompletedId,
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Deleted metric checkout_completed · /plan is one of [team] from web-app.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath(teamMetricPath)}`,
      `DELETE ${projectPath(teamMetricPath)}`,
    ]);
  });

  it("exits 2 saying no metric in the project has the id, with no DELETE, when --id names none", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics/not-a-metric-id": { status: 404, body: {} },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["--id", "not-a-metric-id"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the id "not-a-metric-id".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/metrics/not-a-metric-id")}`,
    ]);
  });

  it("exits 2 naming each experiment with an open run and the runs' environments by slug when the API refuses with METRIC_IN_USE", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: metricInUse,
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr.split("\n")).toEqual([
      "Error: 1 experiment with a run in progress uses checkout_completed, so it was not deleted:",
      "  checkout-cta-copy, running in production, test",
      "Ship or stop each run first, with configdirector configs ship or configs stop, or detach the metric on the experiment's Settings tab in the dashboard.",
      "",
    ]);
  });

  it("names the environments by id when the token cannot read environments", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: metricInUse,
      "/environments": {
        status: 403,
        body: {
          error: "The API token is missing the `environments:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stderr.split("\n")).toContain(
      `  checkout-cta-copy, running in ${productionEnvironment.id}, ${testEnvironment.id}`,
    );
  });

  it("exits 2 saying no metric in the project has the event name, with no DELETE, when the project has none for it", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics?eventName=checkout_complete": { status: 200, body: [] },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_complete"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_complete".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/metrics?eventName=checkout_complete")}`,
    ]);
  });

  it("exits 2 saying no metric in the project has the event name when the metric is gone by the time of the DELETE", async () => {
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

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_completed".\n');
  });

  it("sends the delete request with the bearer token and the cli source client", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 204 },
    });

    await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    const deleteRequest = adminApi.receivedRequests.find((request) => request.method === "DELETE");
    expect({
      authorization: deleteRequest?.headers.authorization,
      sourceClient: deleteRequest?.headers["x-sourceclient"],
    }).toEqual({
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
    });
  });

  it("exits 2 saying no metric in the project has the event name when the API answers the DELETE with 404 and an empty body", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 404, body: {} },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No metric in web-app has the event name "checkout_completed".\n');
  });

  it("exits 2 reporting an unexpected response when the API answers 409 for another reason", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: { status: 409, body: { error: "The API token has expired", code: "API_TOKEN_EXPIRED" } },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(`${projectPath(metricPath)} with HTTP 409.`);
  });

  it("exits 2 naming the missing permission when the token cannot delete metrics", async () => {
    const adminApi = await startBrowseAdminApi({
      [listedByEventName]: { status: 200, body: [checkoutCompleted] },
      [metricPath]: {
        status: 403,
        body: {
          error: "The API token is missing the `metrics:delete` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, ["checkout_completed"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("metrics:delete");
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
  });

  it("exits 2 without a request when neither an event name nor --id is given", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await deleteMetric(adminApi.baseUrl, []);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: Name the metric by its event name, or by its id with --id.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
