import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const createMetric = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
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
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const createdCheckoutCompleted = {
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  projectId: webApp.id,
  eventName: "checkout_completed",
  description: "Orders paid for.",
  direction: "higher-is-better",
  kinds: ["conversion", "value-per-context"],
  usages: [],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

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

  it("exits 2 listing the API's errors when the API rejects the metric, a taken event name included", async () => {
    const adminApi = await startBrowseAdminApi({
      "/metrics": {
        status: 400,
        body: {
          errors: [{ name: "eventName", message: "The project already has a metric for this event name" }],
        },
      },
    });

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, checkoutCompletedOptions);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  eventName: The project already has a metric for this event name\n",
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
  it("exits 2 without a request when --event-name is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, [
      "--kind",
      "conversion",
      "--direction",
      "higher-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--event-name <event name>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --kind is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createMetric(adminApi.baseUrl, [
      "--event-name",
      "checkout_completed",
      "--direction",
      "higher-is-better",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--kind <kind>' not specified");
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
