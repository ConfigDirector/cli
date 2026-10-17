import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { requestLinesOf } from "./support/browse-admin-api.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const mobileApp = {
  ...webApp,
  id: "2b4d6f8a-1c3e-4a5b-8d7f-9e0a1b2c3d4e",
  name: "Mobile App",
  slug: "mobile",
};

const listProjectsIn = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[] = [],
  environmentVariables: Record<string, string> = {},
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: ["projects", "list", "--token", "cd_flag_token", ...commandLineArguments],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl, ...environmentVariables },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const listProjects = async (baseUrl: string, commandLineArguments: string[] = []) =>
  listProjectsIn(await createSandbox(), baseUrl, commandLineArguments);

describe("projects list", () => {
  it("prints one line per project with its slug and name", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp, mobileApp] });

    const { exitCode, stdout, stderr } = await listProjects(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual(["web-app   Web App", "mobile    Mobile App", ""]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startStubAdminApi({
      status: 200,
      body: [{ ...webApp, addedByALaterApi: { reason: "kept" } }],
    });

    const { exitCode, stdout, stderr } = await listProjects(adminApi.baseUrl, ["--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([{ ...webApp, addedByALaterApi: { reason: "kept" } }]);
  });

  it("lists every project with one request whatever --project, CONFIGDIRECTOR_PROJECT and configdirector.json select", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp, mobileApp] });
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "configdirector.json", "{ not json");

    const { exitCode, stdout, stderr } = await listProjectsIn(
      sandbox,
      adminApi.baseUrl,
      ["--project", "no-such-project"],
      { CONFIGDIRECTOR_PROJECT: "another-missing-project" },
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual(["web-app   Web App", "mobile    Mobile App", ""]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
  });

  it("says no projects were found when the organization has none", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [] });

    const { exitCode, stdout, stderr } = await listProjects(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No projects found.\n");
  });
});
