import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment, testEnvironment } from "./support/evaluate-admin-api.js";
import { createSandbox } from "./support/sandbox.js";

const deleteSegment = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "segments",
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

describe("segments delete", () => {
  it("deletes the segment with no read of it first and prints a line saying so", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-testers": { status: 204 } });

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, ["beta-testers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual(["Deleted segment beta-testers from web-app.", ""]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/segments/beta-testers")}`,
    ]);
  });

  it("prints the deleted segment's key as given, and nothing else, with --json", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-testers": { status: 204 } });

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, ["beta-testers", "--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ deletedSegmentKey: "beta-testers" });
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/segments/beta-testers")}`,
    ]);
  });

  it("sends the delete request with the bearer token and the cli source client", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-testers": { status: 204 } });

    await deleteSegment(adminApi.baseUrl, ["beta-testers"]);

    const deleteRequest = adminApi.receivedRequests.find((request) => request.method === "DELETE");
    expect({
      authorization: deleteRequest?.headers.authorization,
      sourceClient: deleteRequest?.headers["x-sourceclient"],
    }).toEqual({
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
    });
  });
});

const segmentInUse = {
  status: 409,
  body: {
    error: "The segment is used by the targeting rules of 2 configs",
    code: "SEGMENT_IN_USE",
    usages: [
      { configKey: "new-checkout", environmentIds: [productionEnvironment.id] },
      { configKey: "dark-mode", environmentIds: [testEnvironment.id, productionEnvironment.id] },
    ],
  },
};

describe("segments delete failures", () => {
  it("exits 2 naming each config whose targeting rules use the segment and their environments by slug when the API refuses with SEGMENT_IN_USE", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-testers": segmentInUse });

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, ["beta-testers"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr.split("\n")).toEqual([
      "Error: The targeting rules of 2 configs use the segment beta-testers, so it was not deleted:",
      "  new-checkout in production",
      "  dark-mode in test, production",
      "Remove those segment conditions first, with configdirector targeting-rules set.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/segments/beta-testers")}`,
      `GET ${projectPath("/environments")}`,
    ]);
  });

  it("names the environments by id when the token cannot read environments", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": segmentInUse,
      "/environments": {
        status: 403,
        body: {
          error: "The API token is missing the `environments:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, ["beta-testers"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr.split("\n")).toEqual(
      expect.arrayContaining([
        `  new-checkout in ${productionEnvironment.id}`,
        `  dark-mode in ${testEnvironment.id}, ${productionEnvironment.id}`,
      ]),
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/segments/beta-testers")}`,
      `GET ${projectPath("/environments")}`,
    ]);
  });

  it("exits 2 reporting an unexpected response when the API answers 409 for another reason", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": {
        status: 409,
        body: { error: "The API token has expired", code: "API_TOKEN_EXPIRED" },
      },
    });

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, ["beta-testers"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(`${projectPath("/segments/beta-testers")} with HTTP 409.`);
  });

  it("exits 2 saying no segment in the project has the key when the API answers 404", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-tester": { status: 404, body: {} } });

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, ["beta-tester"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No segment in web-app has the key "beta-tester".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/segments/beta-tester")}`,
    ]);
  });

  it("exits 2 naming the missing permission when the token cannot delete segments", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": {
        status: 403,
        body: {
          error: "The API token is missing the `segments:delete` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, ["beta-testers"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API refused the request: The API token is missing the `segments:delete` permission. (INSUFFICIENT_PERMISSIONS)\n",
    );
  });
});

describe("segments delete usage errors", () => {
  it("exits 2 without a request when the key is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await deleteSegment(adminApi.baseUrl, []);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("missing required argument 'key'");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
