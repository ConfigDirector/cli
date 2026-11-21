import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import {
  acme,
  acmeMobileApp,
  acmeWebApp,
  describedApiToken,
  logIn,
  startSignInAdminApi,
} from "./support/sign-in-admin-api.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const acmeAccount = {
  token: "cd_acme_token",
  name: "Laptop",
  organization: acme,
  permissions: ["configs:read", "projects:read"],
  expiresAt: "2027-01-31T09:30:00.000Z",
};

const getApiToken = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[] = [],
  environmentVariables: Record<string, string> = {},
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: ["api-token", "get", ...commandLineArguments],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl, ...environmentVariables },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

describe("api-token get", () => {
  it("prints the organization, the token's name, kind, permissions, expiration and the CLI sign-in it came from, with one GET /api-token", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    const requestsBefore = adminApi.receivedRequests.length;

    const { exitCode, stdout, stderr } = await getApiToken(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      `Organization: Acme (${acme.id})`,
      "Name: Laptop",
      "Kind: user API token",
      "Permissions: configs:read, projects:read",
      "Project access: all projects",
      "Expires: 2027-01-31 09:30 UTC",
      "Source: the CLI sign-in for Acme",
      "",
    ]);
    expect(stdout).not.toContain("cd_acme_token");
    expect(adminApi.receivedRequests.slice(requestsBefore).map((request) => request.path)).toEqual([
      "/v1/api-token",
    ]);
  });

  it("says the token never expires and that it came from CONFIGDIRECTOR_TOKEN", async () => {
    const adminApi = await startSignInAdminApi([
      { token: "cd_ci_token", name: "CI", organization: acme, permissions: [], expiresAt: null },
    ]);
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await getApiToken(sandbox, adminApi.baseUrl, [], {
      CONFIGDIRECTOR_TOKEN: "cd_ci_token",
    });

    expect(exitCode).toEqual(0);
    expect(stdout.split("\n")).toEqual([
      `Organization: Acme (${acme.id})`,
      "Name: CI",
      "Kind: user API token",
      "Permissions: none",
      "Project access: all projects",
      "Expires: never",
      "Source: CONFIGDIRECTOR_TOKEN",
      "",
    ]);
  });

  it("shows the kind of an organization API token", async () => {
    const adminApi = await startSignInAdminApi([{ ...acmeAccount, kind: "organization" }]);
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await getApiToken(sandbox, adminApi.baseUrl, ["--token", "cd_acme_token"]);

    expect(exitCode).toEqual(0);
    expect(stdout.split("\n")).toEqual([
      `Organization: Acme (${acme.id})`,
      "Name: Laptop",
      "Kind: organization API token",
      "Permissions: configs:read, projects:read",
      "Project access: all projects",
      "Expires: 2027-01-31 09:30 UTC",
      "Source: --token",
      "",
    ]);
  });

  it("lists the ids of the selected projects of a token limited to them", async () => {
    const adminApi = await startSignInAdminApi([
      {
        ...acmeAccount,
        projectAccess: { kind: "selected", projectIds: [acmeWebApp.id, acmeMobileApp.id] },
      },
    ]);
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await getApiToken(sandbox, adminApi.baseUrl, ["--token", "cd_acme_token"]);

    expect(exitCode).toEqual(0);
    expect(stdout.split("\n")).toEqual([
      `Organization: Acme (${acme.id})`,
      "Name: Laptop",
      "Kind: user API token",
      "Permissions: configs:read, projects:read",
      `Project access: selected projects (${acmeWebApp.id}, ${acmeMobileApp.id})`,
      "Expires: 2027-01-31 09:30 UTC",
      "Source: --token",
      "",
    ]);
  });

  it("says a token limited to selected projects reaches none when every selected project was deleted", async () => {
    const adminApi = await startSignInAdminApi([
      { ...acmeAccount, projectAccess: { kind: "selected", projectIds: [] } },
    ]);
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await getApiToken(sandbox, adminApi.baseUrl, ["--token", "cd_acme_token"]);

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("\nProject access: selected projects (none)\n");
  });

  it("says the token reaches all projects when the Admin API does not describe its project access", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/api-token": {
          status: 200,
          body: { name: "Laptop", organization: acme, permissions: ["projects:read"], expiresAt: null },
        },
      },
    );
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await getApiToken(sandbox, adminApi.baseUrl, ["--token", "cd_acme_token"]);

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("\nProject access: all projects\n");
  });

  it("says the token is a user API token when the Admin API does not give its kind", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/api-token": {
          status: 200,
          body: {
            name: "Laptop",
            organization: acme,
            permissions: ["projects:read"],
            projectAccess: { kind: "all" },
            expiresAt: null,
          },
        },
      },
    );
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await getApiToken(sandbox, adminApi.baseUrl, ["--token", "cd_acme_token"]);

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("\nKind: user API token\n");
  });

  it("says the token came from --token", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await getApiToken(sandbox, adminApi.baseUrl, ["--token", "cd_acme_token"]);

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("Source: --token\n");
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/api-token": {
          status: 200,
          body: { ...describedApiToken(acmeAccount), addedByALaterApi: { reason: "kept" } },
        },
      },
    );
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await getApiToken(sandbox, adminApi.baseUrl, [
      "--token",
      "cd_acme_token",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({
      ...describedApiToken(acmeAccount),
      addedByALaterApi: { reason: "kept" },
    });
  });

  it("exits 2 showing the API's error code when the token is rejected", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await getApiToken(sandbox, adminApi.baseUrl, [
      "--token",
      "cd_revoked",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("API_TOKEN_NOT_FOUND");
  });
});
