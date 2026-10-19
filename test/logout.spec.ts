import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import {
  acme,
  globex,
  logIn,
  readSignInsFile,
  signInsFileExists,
  startSignInAdminApi,
  userConfigDirectoryOf,
} from "./support/sign-in-admin-api.js";

const acmeAccount = { token: "cd_acme_token", organization: acme };

const globexAccount = { token: "cd_globex_token", organization: globex };

const logOut = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[] = [],
  environmentVariables: Record<string, string> = {},
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: ["logout", ...commandLineArguments],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl, ...environmentVariables },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

describe("logout", () => {
  it("removes only the sign-in `organization` in configdirector.json names, with no request, even when CONFIGDIRECTOR_TOKEN is set", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      `${JSON.stringify({ project: "web-app", organization: acme.id })}\n`,
    );
    const requestsBefore = adminApi.receivedRequests.length;

    const { exitCode, stdout, stderr } = await logOut(sandbox, adminApi.baseUrl, [], {
      CONFIGDIRECTOR_TOKEN: "cd_other_token",
    });

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual(
      "Signed out of Acme. The API token keeps working until it is revoked on the dashboard's API tokens page.\n",
    );
    expect(adminApi.receivedRequests.length).toEqual(requestsBefore);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: globex, token: "cd_globex_token" }],
    });
  });

  it("removes the sign-in --organization names by its saved name", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");

    const { exitCode } = await logOut(sandbox, adminApi.baseUrl, ["--organization", "globex"]);

    expect(exitCode).toEqual(0);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
  });

  it("removes the only sign-in when no organization is named", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const { exitCode } = await logOut(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(await readSignInsFile(sandbox)).toEqual({ signIns: [] });
  });

  it("exits 2 naming both sign-ins and removes nothing when there are two and none is named", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");

    const { exitCode, stdout, stderr } = await logOut(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("Acme");
    expect(stderr).toContain("Globex");
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [
        { organization: acme, token: "cd_acme_token" },
        { organization: globex, token: "cd_globex_token" },
      ],
    });
  });

  it("exits 2 naming login when there is no sign-in", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stderr } = await logOut(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("configdirector login");
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });

  it("exits 2 as a usage error with --token", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const { exitCode, stderr } = await logOut(sandbox, adminApi.baseUrl, ["--token", "cd_acme_token"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("--token");
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
  });

  it("moves the token saved by an earlier version into a sign-in with one GET /api-token, then removes that sign-in", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await mkdir(userConfigDirectoryOf(sandbox), { recursive: true });
    await writeFile(join(userConfigDirectoryOf(sandbox), "config.json"), '{ "token": "cd_acme_token" }\n');

    const { exitCode, stdout } = await logOut(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("Signed out of Acme.");
    expect(adminApi.receivedRequests.map((request) => [request.path, request.headers.authorization])).toEqual(
      [["/v1/api-token", "Bearer cd_acme_token"]],
    );
    expect(await readdir(userConfigDirectoryOf(sandbox))).toEqual(["sign-ins.json"]);
    expect(await readSignInsFile(sandbox)).toEqual({ signIns: [] });
  });

  it("prints only JSON naming the removed sign-in's organization on stdout with --json", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const { exitCode, stdout } = await logOut(sandbox, adminApi.baseUrl, ["--json"]);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(stdout)).toEqual({ removedSignIn: { organization: acme } });
  });
});
