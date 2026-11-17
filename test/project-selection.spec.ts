import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox } from "./support/sandbox.js";
import {
  acme,
  acmeMobileApp,
  acmeWebApp,
  startSignInAdminApi,
  type ProjectAccess,
} from "./support/sign-in-admin-api.js";

const startAcmeAdminApi = (projectAccess: ProjectAccess) =>
  startSignInAdminApi(
    [{ token: "cd_acme_token", organization: acme, projectAccess, projects: [acmeWebApp] }],
    { [`/v1/projects/${acmeWebApp.id}/configs`]: { status: 200, body: [] } },
  );

const listConfigs = async (baseUrl: string, projectSlug: string) => {
  const invocation = (await createSandbox()).invocation({
    commandLineArguments: ["configs", "list", "--project", projectSlug, "--token", "cd_acme_token"],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const requestPathsOf = (adminApi: Awaited<ReturnType<typeof startAcmeAdminApi>>) =>
  adminApi.receivedRequests.map((request) => request.path);

describe("project selection", () => {
  it("exits 2 saying the project may be outside the token's project access when no selected project has the slug", async () => {
    const adminApi = await startAcmeAdminApi({ kind: "selected", projectIds: [acmeWebApp.id] });

    const { exitCode, stdout, stderr } = await listConfigs(adminApi.baseUrl, acmeMobileApp.slug);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No project the API token can reach has the slug "mobile-app". ' +
        "The token is limited to selected projects, so the project may be outside its project access.\n",
    );
    expect(requestPathsOf(adminApi)).toEqual(["/v1/projects", "/v1/api-token"]);
  });

  it("exits 2 saying no project in the token's organization has the slug when the token reaches all projects", async () => {
    const adminApi = await startAcmeAdminApi({ kind: "all" });

    const { exitCode, stdout, stderr } = await listConfigs(adminApi.baseUrl, acmeMobileApp.slug);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No project in the API token\'s organization has the slug "mobile-app".\n');
    expect(requestPathsOf(adminApi)).toEqual(["/v1/projects", "/v1/api-token"]);
  });

  it("asks nothing about the token when a project the token reaches has the slug", async () => {
    const adminApi = await startAcmeAdminApi({ kind: "selected", projectIds: [acmeWebApp.id] });

    const { exitCode } = await listConfigs(adminApi.baseUrl, acmeWebApp.slug);

    expect(exitCode).toEqual(0);
    expect(requestPathsOf(adminApi)).toEqual(["/v1/projects", `/v1/projects/${acmeWebApp.id}/configs`]);
  });
});
