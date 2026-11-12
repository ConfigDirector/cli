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
