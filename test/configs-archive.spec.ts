import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { createSandbox } from "./support/sandbox.js";

const archiveConfig = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "configs",
      "archive",
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

describe("configs archive", () => {
  it("archives the config with no read of it first and says it can be restored from the dashboard for 30 days", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs/new-checkout": { status: 204 } });

    const { exitCode, stdout, stderr } = await archiveConfig(adminApi.baseUrl, ["new-checkout"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Archived new-checkout in web-app. It can be restored from the dashboard for 30 days.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/configs/new-checkout")}`,
    ]);
  });

  it("sends the archive request with the bearer token and the cli source client", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs/new-checkout": { status: 204 } });

    await archiveConfig(adminApi.baseUrl, ["new-checkout"]);

    const deleteRequest = adminApi.receivedRequests.find((request) => request.method === "DELETE");
    expect({
      authorization: deleteRequest?.headers.authorization,
      sourceClient: deleteRequest?.headers["x-sourceclient"],
    }).toEqual({
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
    });
  });

  it("prints the archived config's key as given, and nothing else, with --json", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs/new-checkout": { status: 204 } });

    const { exitCode, stdout, stderr } = await archiveConfig(adminApi.baseUrl, ["new-checkout", "--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ archivedConfigKey: "new-checkout" });
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/configs/new-checkout")}`,
    ]);
  });
});

describe("configs archive failures", () => {
  it("exits 2 saying no config in the project has the key, with no further request, when the API answers 404", async () => {
    const adminApi = await startBrowseAdminApi({ "/configs/new-chekout": { status: 404, body: {} } });

    const { exitCode, stdout, stderr } = await archiveConfig(adminApi.baseUrl, ["new-chekout"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/configs/new-chekout")}`,
    ]);
  });

  it("exits 2 naming the missing permission when the token cannot archive configs", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/new-checkout": {
        status: 403,
        body: {
          error: "The API token is missing the `configs:archive` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await archiveConfig(adminApi.baseUrl, ["new-checkout"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API refused the request: The API token is missing the `configs:archive` permission. (INSUFFICIENT_PERMISSIONS)\n",
    );
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `DELETE ${projectPath("/configs/new-checkout")}`,
    ]);
  });
});

describe("configs archive usage errors", () => {
  it("exits 2 without a request when the key is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await archiveConfig(adminApi.baseUrl, []);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("missing required argument 'key'");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
