import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment, testEnvironment } from "./support/evaluate-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const runSegmentsCommand = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "segments",
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

const traitCondition = (id: string, trait: string, operator: string, targetValues: string[]) => ({
  id,
  kind: "attribute",
  attribute: "traits",
  trait,
  operator,
  targetType: "text",
  targetValues,
});

const segmentOf = (overrides: object) => ({
  id: "8c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f",
  projectId: webApp.id,
  key: "beta-testers",
  name: "Beta testers",
  kind: "rule-based",
  groups: [[traitCondition("condition-email", "/email", "ends with any of", ["@example.com"])]],
  overrides: {},
  usages: [],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  ...overrides,
});

const betaTesters = segmentOf({
  usages: [
    { configKey: "new-checkout", environmentIds: [productionEnvironment.id] },
    { configKey: "dark-mode", environmentIds: [testEnvironment.id, productionEnvironment.id] },
  ],
});

const internalStaff = segmentOf({
  id: "9d0e1f2a-3b4c-4d5e-9f6a-8b9c0d1e2f3a",
  key: "internal",
  name: "Internal staff",
  usages: [{ configKey: "new-checkout", environmentIds: [testEnvironment.id] }],
});

const unusedSegment = segmentOf({
  id: "0e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b",
  key: "unused",
  name: "Unused",
});

describe("segments list", () => {
  it("prints one line per segment with its key, its name and how many configs use it", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments": { status: 200, body: [betaTesters, internalStaff, unusedSegment] },
    });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "beta-testers   Beta testers     used by 2 configs",
      "internal       Internal staff   used by 1 config",
      "unused         Unused           used by 0 configs",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/segments")}`]);
  });

  it("says no segments were found when the project has none", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No segments found in web-app.\n");
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments": { status: 200, body: [{ ...betaTesters, addedByALaterApi: { reason: "kept" } }] },
    });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, ["list", "--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([{ ...betaTesters, addedByALaterApi: { reason: "kept" } }]);
  });
});

const betaTestersWithOverride = segmentOf({
  groups: [
    [traitCondition("condition-email", "/email", "ends with any of", ["@example.com"])],
    [
      traitCondition("condition-plan", "/plan", "is one of", ["beta"]),
      traitCondition("condition-country", "/country", "equals", ["NZ"]),
    ],
  ],
  overrides: {
    [productionEnvironment.id]: [
      [traitCondition("condition-staff", "/email", "ends with any of", ["@staff.example.com"])],
    ],
  },
});

describe("segments get", () => {
  it("prints the segment's key and name, its condition groups, and each environment override by slug", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": { status: 200, body: betaTestersWithOverride },
    });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, ["get", "beta-testers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "beta-testers",
      "  Name: Beta testers",
      "",
      "Project definition",
      "  1. email ends with any of @example.com",
      "  2. plan is one of beta and country equals NZ",
      "",
      "Override in production",
      "  1. email ends with any of @staff.example.com",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
      `GET ${projectPath("/environments")}`,
    ]);
  });

  it("names an override's environment by its id when the token cannot read environments", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": { status: 200, body: betaTestersWithOverride },
      "/environments": {
        status: 403,
        body: {
          error: "The API token is missing the `environments:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, ["get", "beta-testers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toContain(`Override in ${productionEnvironment.id}`);
  });

  it("requests no environment listing when the segment has no environment overrides", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": { status: 200, body: betaTesters },
    });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, ["get", "beta-testers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "beta-testers",
      "  Name: Beta testers",
      "",
      "Project definition",
      "  1. email ends with any of @example.com",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
    ]);
  });

  it("exits 2 saying no segment in the project has the key when the API answers 404", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-tester": { status: 404, body: {} } });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, ["get", "beta-tester"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No segment in web-app has the key "beta-tester".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-tester")}`,
    ]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": {
        status: 200,
        body: { ...betaTestersWithOverride, addedByALaterApi: { reason: "kept" } },
      },
    });

    const { exitCode, stdout, stderr } = await runSegmentsCommand(adminApi.baseUrl, [
      "get",
      "beta-testers",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...betaTestersWithOverride, addedByALaterApi: { reason: "kept" } });
  });
});
