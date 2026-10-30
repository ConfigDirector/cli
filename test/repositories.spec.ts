import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import {
  projectPath,
  requestLinesOf,
  scannedRepositoryNotFound,
  startBrowseAdminApi,
} from "./support/browse-admin-api.js";
import { createSandbox } from "./support/sandbox.js";

const runRepositoriesCommand = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "repositories",
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

const scannedRepository = (overrides: object = {}) => ({
  name: "ConfigDirector/cli",
  remoteUrl: "https://github.com/ConfigDirector/cli.git",
  commit: "4d40f509d1331d512f3afe8201f97339c808d651",
  scannedAt: "2026-10-17T10:00:00.000Z",
  filesScanned: 42,
  referenceCount: 12,
  dynamicReferenceCount: 1,
  ...overrides,
});

const cliRepository = scannedRepository();

const storefrontRepository = scannedRepository({
  name: "acme/storefront",
  remoteUrl: "git@github.com:acme/storefront.git",
  commit: "9f3e2a1b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f",
  scannedAt: "2026-10-16T09:12:34.000Z",
  filesScanned: 7,
  referenceCount: 1,
  dynamicReferenceCount: 0,
});

describe("repositories list", () => {
  it("prints a header row, then one line per scanned repository with its short commit, scan time in UTC and reference counts, then the count out of 50", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories": { status: 200, body: [cliRepository, storefrontRepository] },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "REPOSITORY           COMMIT    SCANNED                REFERENCES      DYNAMIC REFERENCES",
      "ConfigDirector/cli   4d40f50   2026-10-17 10:00 UTC   12 references   1 dynamic reference",
      "acme/storefront      9f3e2a1   2026-10-16 09:12 UTC   1 reference     0 dynamic references",
      "",
      "web-app has 2 of the 50 scanned repositories a project can hold.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/repositories")}`]);
  });

  it("prints the scanned repository lines without the header row with --no-headers, then the count out of 50", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories": { status: 200, body: [cliRepository, storefrontRepository] },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "list",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "ConfigDirector/cli   4d40f50   2026-10-17 10:00 UTC   12 references   1 dynamic reference",
      "acme/storefront      9f3e2a1   2026-10-16 09:12 UTC   1 reference     0 dynamic references",
      "",
      "web-app has 2 of the 50 scanned repositories a project can hold.",
      "",
    ]);
  });

  it("says no commit for a repository uploaded without one", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories": {
        status: 200,
        body: [scannedRepository({ name: "acme/storefront", remoteUrl: "", commit: "" })],
      },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "REPOSITORY        COMMIT      SCANNED                REFERENCES      DYNAMIC REFERENCES",
      "acme/storefront   no commit   2026-10-17 10:00 UTC   12 references   1 dynamic reference",
      "",
      "web-app has 1 of the 50 scanned repositories a project can hold.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/repositories")}`]);
  });

  it("says the project has no scanned repositories and names scan --upload when it has none", async () => {
    const adminApi = await startBrowseAdminApi({ "/repositories": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual(
      "No scanned repositories found in web-app. Run configdirector scan --upload in a repository to upload its code references.\n",
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/repositories")}`]);
  });

  it("says the project has no scanned repositories with --no-headers when it has none", async () => {
    const adminApi = await startBrowseAdminApi({ "/repositories": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "list",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual(
      "No scanned repositories found in web-app. Run configdirector scan --upload in a repository to upload its code references.\n",
    );
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories": {
        status: 200,
        body: [{ ...cliRepository, addedByALaterApi: { reason: "kept" } }, storefrontRepository],
      },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, ["list", "--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([
      { ...cliRepository, addedByALaterApi: { reason: "kept" } },
      storefrontRepository,
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/repositories")}`]);
  });

  it("prints the API's response as received and nothing else with --json and --no-headers", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories": {
        status: 200,
        body: [{ ...cliRepository, addedByALaterApi: { reason: "kept" } }, storefrontRepository],
      },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "list",
      "--json",
      "--no-headers",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([
      { ...cliRepository, addedByALaterApi: { reason: "kept" } },
      storefrontRepository,
    ]);
  });

  it("exits 2 naming the missing permission when the token cannot read code references", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories": {
        status: 403,
        body: {
          error: "The API token is missing the `code-references:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, ["list"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API refused the request: The API token is missing the `code-references:read` permission. (INSUFFICIENT_PERMISSIONS)\n",
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/repositories")}`]);
  });
});

describe("repositories remove", () => {
  it("removes the repository with no read of it first and names the repository and the project", async () => {
    const adminApi = await startBrowseAdminApi({ "/repositories/ConfigDirector%2Fcli": { status: 204 } });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "remove",
      "ConfigDirector/cli",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Removed ConfigDirector/cli and its code references from web-app.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
  });

  it("prints the removed repository's name as given, and nothing else, with --json", async () => {
    const adminApi = await startBrowseAdminApi({ "/repositories/ConfigDirector%2Fcli": { status: 204 } });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "remove",
      "ConfigDirector/cli",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ removedRepository: "ConfigDirector/cli" });
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
  });
});

describe("repositories remove failures", () => {
  it("exits 2 listing the project's scanned repository names when the API answers 404 with an empty body", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories/ConfigDirector%2Fclli": { status: 404, body: {} },
      "/repositories": { status: 200, body: [cliRepository, storefrontRepository] },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "remove",
      "ConfigDirector/clli",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No scanned repository in web-app has the name "ConfigDirector/clli". ' +
        "Its scanned repositories are ConfigDirector/cli, acme/storefront.\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/repositories/ConfigDirector%2Fclli")}`,
      `GET ${projectPath("/repositories")}`,
    ]);
  });

  it("exits 2 listing the project's scanned repository names when the API answers 404 with SCANNED_REPOSITORY_NOT_FOUND", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories/ConfigDirector%2Fclli": scannedRepositoryNotFound("ConfigDirector/clli"),
      "/repositories": { status: 200, body: [cliRepository, storefrontRepository] },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "remove",
      "ConfigDirector/clli",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No scanned repository in web-app has the name "ConfigDirector/clli". ' +
        "Its scanned repositories are ConfigDirector/cli, acme/storefront.\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/repositories/ConfigDirector%2Fclli")}`,
      `GET ${projectPath("/repositories")}`,
    ]);
  });

  it("exits 2 saying the project has no scanned repositories when the API answers 404 and it has none", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories/ConfigDirector%2Fcli": { status: 404, body: {} },
      "/repositories": { status: 200, body: [] },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "remove",
      "ConfigDirector/cli",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No scanned repository in web-app has the name "ConfigDirector/cli". ' +
        "The project has no scanned repositories.\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
      `GET ${projectPath("/repositories")}`,
    ]);
  });

  it("exits 2 saying no scanned repository has the name, without listing names, when the API answers 404 and the token cannot read code references", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories/ConfigDirector%2Fclli": { status: 404, body: {} },
      "/repositories": {
        status: 403,
        body: {
          error: "The API token is missing the `code-references:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "remove",
      "ConfigDirector/clli",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No scanned repository in web-app has the name "ConfigDirector/clli".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/repositories/ConfigDirector%2Fclli")}`,
      `GET ${projectPath("/repositories")}`,
    ]);
  });

  it("exits 2 naming the missing permission when the token cannot update code references", async () => {
    const adminApi = await startBrowseAdminApi({
      "/repositories/ConfigDirector%2Fcli": {
        status: 403,
        body: {
          error: "The API token is missing the `code-references:update` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, [
      "remove",
      "ConfigDirector/cli",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API refused the request: The API token is missing the `code-references:update` permission. (INSUFFICIENT_PERMISSIONS)\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/repositories/ConfigDirector%2Fcli")}`,
    ]);
  });
});

describe("repositories remove usage errors", () => {
  it("exits 2 without a request when the name is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await runRepositoriesCommand(adminApi.baseUrl, ["remove"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("missing required argument 'name'");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
