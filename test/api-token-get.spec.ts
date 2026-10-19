import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { acme, describedApiToken, logIn, startSignInAdminApi } from "./support/sign-in-admin-api.js";
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
  it("prints the organization, the token's name, permissions, expiration and the CLI sign-in it came from, with one GET /api-token", async () => {
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
      "Permissions: configs:read, projects:read",
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
      "Permissions: none",
      "Expires: never",
      "Source: CONFIGDIRECTOR_TOKEN",
      "",
    ]);
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
