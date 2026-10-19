import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment } from "./support/evaluate-admin-api.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const createSegmentIn = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[],
  stdin?: Readable,
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "segments",
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

const createSegmentFromFile = async (
  baseUrl: string,
  segmentFile: object,
  commandLineArguments: string[] = [],
) => {
  const sandbox = await createSandbox();
  await writeRepositoryFile(sandbox.workingDirectory, "segment.json", JSON.stringify(segmentFile, null, 2));
  return createSegmentIn(sandbox, baseUrl, [...commandLineArguments, "--segment", "segment.json"]);
};

const postRequestBodies = (adminApi: Awaited<ReturnType<typeof startBrowseAdminApi>>) =>
  adminApi.receivedRequests.filter((request) => request.method === "POST").map((request) => request.body);

type SentSegment = {
  groups: { id: string }[][];
  overrides: Record<string, { id: string }[][]>;
};

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

const planCondition = {
  id: "c1b2c3d4-0000-4000-8000-000000000002",
  ...traitCondition("/plan", "is one of", ["beta"]),
};

const countryCondition = {
  id: "c1b2c3d4-0000-4000-8000-000000000003",
  ...traitCondition("/country", "equals", ["NZ"]),
};

const staffCondition = {
  id: "c1b2c3d4-0000-4000-8000-000000000004",
  ...traitCondition("/email", "ends with any of", ["@staff.example.com"]),
};

const betaTestersFile = {
  key: "beta-testers",
  name: "Beta testers",
  groups: [[emailCondition], [planCondition, countryCondition]],
  overrides: { [productionEnvironment.id]: [[staffCondition]] },
};

const createdBetaTesters = {
  ...betaTestersFile,
  id: "8c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f",
  projectId: webApp.id,
  kind: "rule-based",
  usages: [],
  createdAt: "2026-10-19T10:00:00.000Z",
  updatedAt: "2026-10-19T10:00:00.000Z",
};

describe("segments create", () => {
  it("sends the file as the segment to create and prints a line saying so, then the segment as segments get prints it", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments": { status: 200, body: createdBetaTesters } });

    const { exitCode, stdout, stderr } = await createSegmentFromFile(adminApi.baseUrl, betaTestersFile);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Created segment beta-testers in web-app.",
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
      `POST ${projectPath("/segments")}`,
      `GET ${projectPath("/environments")}`,
    ]);
    expect(postRequestBodies(adminApi)).toEqual([betaTestersFile]);
  });

  it("gives each condition without an id a UUID of its own, in the condition groups and in each environment override, and keeps the ids given", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments": { status: 200, body: createdBetaTesters } });
    const newEmailCondition = traitCondition("/email", "ends with any of", ["@example.org"]);
    const newStaffCondition = traitCondition("/email", "ends with any of", ["@staff.example.org"]);

    const { exitCode, stderr } = await createSegmentFromFile(adminApi.baseUrl, {
      ...betaTestersFile,
      groups: [[newEmailCondition], [planCondition, countryCondition]],
      overrides: { [productionEnvironment.id]: [[staffCondition, newStaffCondition]] },
    });

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    const [sentBody] = postRequestBodies(adminApi) as [SentSegment];
    expect(sentBody).toEqual({
      ...betaTestersFile,
      groups: [[{ ...newEmailCondition, id: uuid }], [planCondition, countryCondition]],
      overrides: { [productionEnvironment.id]: [[staffCondition, { ...newStaffCondition, id: uuid }]] },
    });
    expect(sentBody.groups[0]?.[0]?.id).not.toEqual(
      sentBody.overrides[productionEnvironment.id]?.[0]?.[1]?.id,
    );
  });

  it("sends a segment as segments get --json prints it with every field as written, for the API to decide on", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments": { status: 200, body: createdBetaTesters } });
    const otherSegmentOutput = {
      ...createdBetaTesters,
      id: "9d0e1f2a-3b4c-4d5e-9f6a-8b9c0d1e2f3a",
      usages: [{ configKey: "new-checkout", environmentIds: [productionEnvironment.id] }],
    };

    const { exitCode, stderr } = await createSegmentFromFile(adminApi.baseUrl, otherSegmentOutput);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(postRequestBodies(adminApi)).toEqual([otherSegmentOutput]);
  });

  it("reads the segment from stdin for --segment -", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments": { status: 200, body: createdBetaTesters } });
    const segmentJson = JSON.stringify(betaTestersFile);
    const stdin = Readable.from([segmentJson.slice(0, 20), segmentJson.slice(20)]);

    const { exitCode, stdout, stderr } = await createSegmentIn(
      await createSandbox(),
      adminApi.baseUrl,
      ["--segment", "-"],
      stdin,
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")[0]).toEqual("Created segment beta-testers in web-app.");
    expect(postRequestBodies(adminApi)).toEqual([betaTestersFile]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments": { status: 200, body: { ...createdBetaTesters, addedByALaterApi: { reason: "kept" } } },
    });

    const { exitCode, stdout, stderr } = await createSegmentFromFile(adminApi.baseUrl, betaTestersFile, [
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...createdBetaTesters, addedByALaterApi: { reason: "kept" } });
  });
});

describe("segments create requests", () => {
  it("sends the segment as JSON in a POST with the bearer token and the cli source client", async () => {
    const adminApi = await startBrowseAdminApi({ "/segments": { status: 200, body: createdBetaTesters } });

    await createSegmentFromFile(adminApi.baseUrl, betaTestersFile);

    const postRequest = adminApi.receivedRequests.find((request) => request.method === "POST");
    expect({
      contentType: postRequest?.headers["content-type"],
      authorization: postRequest?.headers.authorization,
      sourceClient: postRequest?.headers["x-sourceclient"],
    }).toEqual({
      contentType: "application/json",
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
    });
  });
});

describe("segments create failures", () => {
  it("exits 2 listing the API's errors when the API rejects the segment, a taken key included", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments": {
        status: 400,
        body: {
          errors: [
            { name: "key", message: "A segment with this key already exists in the project" },
            { name: "groups.1.0.operator", message: "Operator is required" },
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await createSegmentFromFile(adminApi.baseUrl, betaTestersFile);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  key: A segment with this key already exists in the project\n" +
        "  groups.1.0.operator: Operator is required\n",
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${projectPath("/segments")}`]);
  });

  it("exits 2 naming the missing permission when the token cannot create segments", async () => {
    const adminApi = await startBrowseAdminApi({
      "/segments": {
        status: 403,
        body: {
          error: "The API token is missing the `segments:create` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await createSegmentFromFile(adminApi.baseUrl, betaTestersFile);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("segments:create");
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${projectPath("/segments")}`]);
  });
});

describe("segments create usage errors", () => {
  it("exits 2 without a request naming the file when the --segment file does not hold a JSON object", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "segment.json", JSON.stringify([betaTestersFile]));

    const { exitCode, stdout, stderr } = await createSegmentIn(sandbox, adminApi.baseUrl, [
      "--segment",
      "segment.json",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(`--segment names ${join(sandbox.workingDirectory, "segment.json")}`);
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --segment is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await createSegmentIn(await createSandbox(), adminApi.baseUrl, []);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--segment <file>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
