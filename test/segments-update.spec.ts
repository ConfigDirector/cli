import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import {
  projectPath,
  requestLinesOf,
  segmentNotFound,
  startBrowseAdminApi,
} from "./support/browse-admin-api.js";
import { productionEnvironment } from "./support/evaluate-admin-api.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";
import type { StubReplyForRequest } from "./support/stub-admin-api.js";

const updateSegmentIn = async (sandbox: Sandbox, baseUrl: string, commandLineArguments: string[]) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "segments",
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

const updateSegmentFromFile = async (
  baseUrl: string,
  segmentFile: object,
  commandLineArguments: string[],
) => {
  const sandbox = await createSandbox();
  await writeRepositoryFile(sandbox.workingDirectory, "segment.json", JSON.stringify(segmentFile, null, 2));
  return updateSegmentIn(sandbox, baseUrl, [...commandLineArguments, "--segment", "segment.json"]);
};

const putRequestBodies = (adminApi: Awaited<ReturnType<typeof startBrowseAdminApi>>) =>
  adminApi.receivedRequests.filter((request) => request.method === "PUT").map((request) => request.body);

const uuid = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const traitCondition = (trait: string, operator: string, targetValues: string[]) => ({
  kind: "attribute",
  attribute: "traits",
  trait,
  operator,
  targetType: "text",
  targetValues,
});

const emailCondition = {
  id: "c1b2c3d4-0000-4000-8000-000000000001",
  ...traitCondition("/email", "ends with any of", ["@example.com"]),
};

const staffCondition = {
  id: "c1b2c3d4-0000-4000-8000-000000000004",
  ...traitCondition("/email", "ends with any of", ["@staff.example.com"]),
};

const segmentOf = (fields: object) => ({
  id: "8c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f",
  projectId: webApp.id,
  key: "beta-testers",
  name: "Beta testers",
  kind: "rule-based",
  groups: [[emailCondition]],
  overrides: {},
  usages: [],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  ...fields,
});

const betaTesters = segmentOf({});

const internalStaffOutput = segmentOf({
  id: "9d0e1f2a-3b4c-4d5e-9f6a-8b9c0d1e2f3a",
  key: "internal",
  name: "Internal staff",
  usages: [{ configKey: "new-checkout", environmentIds: [productionEnvironment.id] }],
});

const readAndUpdateReplies =
  (currentSegment: object, updatedSegment: object): StubReplyForRequest =>
  (request) =>
    request.method === "PUT" ? { status: 200, body: updatedSegment } : { status: 200, body: currentSegment };

describe("segments update", () => {
  it("sends the file with the id of the segment the key names in place of the file's, and prints a line saying so, then the segment as segments get prints it", async () => {
    const editedFile = {
      ...internalStaffOutput,
      key: "beta-testers",
      name: "Beta testers and staff",
      overrides: { [productionEnvironment.id]: [[staffCondition]] },
    };
    const updatedBetaTesters = segmentOf({
      name: "Beta testers and staff",
      overrides: { [productionEnvironment.id]: [[staffCondition]] },
    });
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": readAndUpdateReplies(betaTesters, updatedBetaTesters),
    });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, editedFile, [
      "beta-testers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Updated segment beta-testers in web-app.",
      "beta-testers",
      "  Name: Beta testers and staff",
      "",
      "Project definition",
      "  1. email ends with any of @example.com",
      "",
      "Override in production",
      "  1. email ends with any of @staff.example.com",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
      `PUT ${projectPath("/segments/beta-testers")}`,
      `GET ${projectPath("/environments")}`,
    ]);
    expect(putRequestBodies(adminApi)).toEqual([{ ...editedFile, id: betaTesters.id }]);
  });

  it("renames the segment the key names when the file holds another key", async () => {
    const renamedFile = { ...betaTesters, key: "early-access", name: "Early access" };
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": readAndUpdateReplies(betaTesters, renamedFile),
    });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, renamedFile, [
      "beta-testers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n").slice(0, 3)).toEqual([
      "Updated segment beta-testers in web-app.",
      "early-access",
      "  Name: Early access",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
      `PUT ${projectPath("/segments/beta-testers")}`,
    ]);
    expect(putRequestBodies(adminApi)).toEqual([renamedFile]);
  });

  it("gives each condition without an id a UUID of its own and keeps the ids given", async () => {
    const newStaffCondition = traitCondition("/email", "ends with any of", ["@staff.example.com"]);
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": readAndUpdateReplies(betaTesters, betaTesters),
    });

    const { exitCode, stderr } = await updateSegmentFromFile(
      adminApi.baseUrl,
      { key: "beta-testers", name: "Beta testers", groups: [[emailCondition, newStaffCondition]] },
      ["beta-testers"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(putRequestBodies(adminApi)).toEqual([
      {
        key: "beta-testers",
        name: "Beta testers",
        groups: [[emailCondition, { ...newStaffCondition, id: uuid }]],
        id: betaTesters.id,
      },
    ]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": readAndUpdateReplies(betaTesters, {
        ...betaTesters,
        addedByALaterApi: { reason: "kept" },
      }),
    });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, betaTesters, [
      "beta-testers",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...betaTesters, addedByALaterApi: { reason: "kept" } });
  });

  it("sends the segment as JSON in a PUT with the bearer token and the cli source client", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": readAndUpdateReplies(betaTesters, betaTesters),
    });

    await updateSegmentFromFile(adminApi.baseUrl, betaTesters, ["beta-testers"]);

    const putRequest = adminApi.receivedRequests.find((request) => request.method === "PUT");
    expect({
      contentType: putRequest?.headers["content-type"],
      authorization: putRequest?.headers.authorization,
      sourceClient: putRequest?.headers["x-sourceclient"],
    }).toEqual({
      contentType: "application/json",
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
    });
  });
});

describe("segments update failures", () => {
  it("exits 2 saying no segment in the project has the key, with no PUT, when the API answers 404 with an empty body to the read", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-tester": { status: 404, body: {} } });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, betaTesters, [
      "beta-tester",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No segment in web-app has the key "beta-tester".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-tester")}`,
    ]);
  });

  it("exits 2 saying no segment in the project has the key, with no PUT, when the API answers 404 with SEGMENT_NOT_FOUND to the read", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments/beta-tester": segmentNotFound("beta-tester") });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, betaTesters, [
      "beta-tester",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No segment in web-app has the key "beta-tester".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-tester")}`,
    ]);
  });

  it("exits 2 listing the API's errors when the API rejects the segment", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": (request) =>
        request.method === "PUT"
          ? {
              status: 400,
              body: {
                errors: [
                  {
                    name: "overrides",
                    message: "An override must be keyed by the UUID of an environment in the project",
                  },
                ],
              },
            }
          : { status: 200, body: betaTesters },
    });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(
      adminApi.baseUrl,
      { ...betaTesters, overrides: { production: [[staffCondition]] } },
      ["beta-testers"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  overrides: An override must be keyed by the UUID of an environment in the project\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
      `PUT ${projectPath("/segments/beta-testers")}`,
    ]);
  });

  it("exits 2 naming the missing permission when the token cannot update segments", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": (request) =>
        request.method === "PUT"
          ? {
              status: 403,
              body: {
                error: "The API token is missing the `segments:update` permission.",
                code: "INSUFFICIENT_PERMISSIONS",
              },
            }
          : { status: 200, body: betaTesters },
    });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, betaTesters, [
      "beta-testers",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("segments:update");
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
      `PUT ${projectPath("/segments/beta-testers")}`,
    ]);
  });

  it("exits 2 saying no segment in the project has the key when the segment is gone by the time of the PUT, answered with an empty body", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": (request) =>
        request.method === "PUT" ? { status: 404, body: {} } : { status: 200, body: betaTesters },
    });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, betaTesters, [
      "beta-testers",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No segment in web-app has the key "beta-testers".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
      `PUT ${projectPath("/segments/beta-testers")}`,
    ]);
  });

  it("exits 2 saying no segment in the project has the key when the segment is gone by the time of the PUT, answered with SEGMENT_NOT_FOUND", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments/beta-testers": (request) =>
        request.method === "PUT" ? segmentNotFound("beta-testers") : { status: 200, body: betaTesters },
    });

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, betaTesters, [
      "beta-testers",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No segment in web-app has the key "beta-testers".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/segments/beta-testers")}`,
      `PUT ${projectPath("/segments/beta-testers")}`,
    ]);
  });
});

describe("segments update usage errors", () => {
  it("exits 2 without a request when --segment is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await updateSegmentIn(await createSandbox(), adminApi.baseUrl, [
      "beta-testers",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--segment <file>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when the key is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await updateSegmentFromFile(adminApi.baseUrl, betaTesters, []);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("missing required argument 'key'");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
