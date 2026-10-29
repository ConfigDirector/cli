import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment, testEnvironment } from "./support/evaluate-admin-api.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";

const listEnvironmentsIn = async (sandbox: Sandbox, baseUrl: string, commandLineArguments: string[] = []) => {
  const invocation = sandbox.invocation({
    commandLineArguments: ["environments", "list", "--token", "cd_flag_token", ...commandLineArguments],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const listEnvironments = async (baseUrl: string, commandLineArguments: string[] = []) =>
  listEnvironmentsIn(await createSandbox(), baseUrl, ["--project", "web-app", ...commandLineArguments]);

describe("environments list", () => {
  it("prints a header row, then one line per environment with its slug and name, marking the live ones", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await listEnvironments(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "SLUG         NAME         LIVE",
      "test         Test",
      "production   Production   live",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `GET ${projectPath("/environments")}`]);
  });

  it("prints the environment lines without the header row with --no-headers", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await listEnvironments(adminApi.baseUrl, ["--no-headers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual(["test         Test", "production   Production   live", ""]);
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({
      "/environments": {
        status: 200,
        body: [testEnvironment, { ...productionEnvironment, addedByALaterApi: { reason: "kept" } }],
      },
    });

    const { exitCode, stdout, stderr } = await listEnvironments(adminApi.baseUrl, ["--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([
      testEnvironment,
      { ...productionEnvironment, addedByALaterApi: { reason: "kept" } },
    ]);
  });

  it("prints the API's response as received and nothing else with --json and --no-headers", async () => {
    const adminApi = await startBrowseAdminApi({
      "/environments": {
        status: 200,
        body: [testEnvironment, { ...productionEnvironment, addedByALaterApi: { reason: "kept" } }],
      },
    });

    const { exitCode, stdout, stderr } = await listEnvironments(adminApi.baseUrl, ["--json", "--no-headers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual([
      testEnvironment,
      { ...productionEnvironment, addedByALaterApi: { reason: "kept" } },
    ]);
  });

  it("lists the environments of the project linked by configdirector.json when no project is named", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();
    const environmentVariables = {
      CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
      CONFIGDIRECTOR_TOKEN: "cd_env_token",
    };
    await run(
      sandbox.invocation({ commandLineArguments: ["init", "--project", "web-app"], environmentVariables }),
    );

    const { exitCode, stdout, stderr } = await listEnvironmentsIn(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "SLUG         NAME         LIVE",
      "test         Test",
      "production   Production   live",
      "",
    ]);
    expect(requestLinesOf(adminApi).at(-1)).toEqual(`GET ${projectPath("/environments")}`);
  });

  it("says no environments were found when the project has none", async () => {
    const adminApi = await startBrowseAdminApi({ "/environments": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await listEnvironments(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No environments found in web-app.\n");
  });

  it("says no environments were found with --no-headers when the project has none", async () => {
    const adminApi = await startBrowseAdminApi({ "/environments": { status: 200, body: [] } });

    const { exitCode, stdout, stderr } = await listEnvironments(adminApi.baseUrl, ["--no-headers"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual("No environments found in web-app.\n");
  });
});
