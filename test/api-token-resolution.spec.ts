import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import {
  acme,
  acmeWebApp,
  globex,
  globexWebApp,
  logIn,
  readSignInsFile,
  signInsFileExists,
  startSignInAdminApi,
  userConfigDirectoryOf,
} from "./support/sign-in-admin-api.js";

const acmeAccount = { token: "cd_acme_token", organization: acme, projects: [acmeWebApp] };

const globexAccount = { token: "cd_globex_token", organization: globex, projects: [globexWebApp] };

const writeConfigJson = async (sandbox: Sandbox, token: string) => {
  await mkdir(userConfigDirectoryOf(sandbox), { recursive: true });
  await writeFile(join(userConfigDirectoryOf(sandbox), "config.json"), `${JSON.stringify({ token })}\n`);
};

const listProjects = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[] = [],
  environmentVariables: Record<string, string> = {},
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: ["projects", "list", ...commandLineArguments],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl, ...environmentVariables },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const projectRequestTokens = (adminApi: Awaited<ReturnType<typeof startSignInAdminApi>>) =>
  adminApi.receivedRequests
    .filter((request) => request.path === "/v1/projects")
    .map((request) => request.headers.authorization);

describe("API token resolution", () => {
  it("sends the --token value even when CONFIGDIRECTOR_TOKEN is set and a sign-in is saved", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, { ...globexAccount, token: "cd_flag_token" }]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl, ["--token", "cd_flag_token"], {
      CONFIGDIRECTOR_TOKEN: "cd_variable_token",
    });

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_flag_token"]);
  });

  it("sends CONFIGDIRECTOR_TOKEN when no --token is given, even when a sign-in is saved", async () => {
    const adminApi = await startSignInAdminApi([
      acmeAccount,
      { ...globexAccount, token: "cd_variable_token" },
    ]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl, [], {
      CONFIGDIRECTOR_TOKEN: "cd_variable_token",
    });

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_variable_token"]);
  });

  it("exits 2 naming CONFIGDIRECTOR_TOKEN and login without calling the Admin API when no token is found", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("CONFIGDIRECTOR_TOKEN");
    expect(stderr).toContain("configdirector login");
    expect(stdout).toEqual("");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("sends the only sign-in's token when neither --token nor CONFIGDIRECTOR_TOKEN is set, whatever configdirector.json names", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    await writeRepositoryFile(sandbox.workingDirectory, "configdirector.json", '{ "project": "web-app" }\n');

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_acme_token"]);
  });

  it("treats an empty CONFIGDIRECTOR_TOKEN as unset and sends the sign-in's token", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl, [], { CONFIGDIRECTOR_TOKEN: "" });

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_acme_token"]);
  });

  it("exits 2 naming the sign-ins file when it is not valid", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const signInsFile = join(userConfigDirectoryOf(sandbox), "sign-ins.json");
    await mkdir(userConfigDirectoryOf(sandbox), { recursive: true });
    await writeFile(signInsFile, '{ "signIns": ');

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(signInsFile);
    expect(adminApi.receivedRequests).toEqual([]);
  });
});

describe("API token resolution in a linked repository", () => {
  it("exits 2 naming CONFIGDIRECTOR_TOKEN and login when configdirector.json names an organization and there is no sign-in", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      `${JSON.stringify({ project: "web-app", organization: acme.id })}\n`,
    );

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("No API token found");
    expect(stderr).toContain("CONFIGDIRECTOR_TOKEN");
    expect(stderr).toContain("configdirector login");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 naming the file and the sign-ins there are when configdirector.json names an organization none is for", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      `${JSON.stringify({ project: "web-app", organization: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f" })}\n`,
    );

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("configdirector.json");
    expect(stderr).toContain("3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f");
    expect(stderr).toContain("Acme");
    expect(stderr).toContain("Globex");
    expect(projectRequestTokens(adminApi)).toEqual([]);
  });

  it("matches `organization` in configdirector.json by id only, not by a saved name", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      `${JSON.stringify({ project: "web-app", organization: "Globex" })}\n`,
    );

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("Globex, which configdirector.json names");
    expect(projectRequestTokens(adminApi)).toEqual([]);
  });
});

describe("API token resolution with two sign-ins", () => {
  const signInToBoth = async (sandbox: Sandbox, baseUrl: string) => {
    await logIn(sandbox, baseUrl, "cd_acme_token");
    await logIn(sandbox, baseUrl, "cd_globex_token");
  };

  it("sends the token of the sign-in that `organization` in configdirector.json names", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      `${JSON.stringify({ project: "web-app", organization: globex.id })}\n`,
    );

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_globex_token"]);
  });

  it("sends the token of the sign-in whose saved name --organization gives in another case, over the file's organization", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      `${JSON.stringify({ project: "web-app", organization: acme.id })}\n`,
    );

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl, ["--organization", "GLOBEX"]);

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_globex_token"]);
  });

  it("sends the token of the sign-in whose organization id --organization gives", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl, ["--organization", globex.id]);

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_globex_token"]);
  });

  it("sends the token of the sign-in CONFIGDIRECTOR_ORGANIZATION names when --organization is not given", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl, [], {
      CONFIGDIRECTOR_ORGANIZATION: "globex",
    });

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_globex_token"]);
  });

  it("exits 2 asking for the id when two sign-ins share the name --organization gives", async () => {
    const adminApi = await startSignInAdminApi([
      acmeAccount,
      { ...globexAccount, organization: { ...globex, name: "Acme" } },
    ]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl, ["--organization", "acme"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(acme.id);
    expect(stderr).toContain(globex.id);
    expect(projectRequestTokens(adminApi)).toEqual([]);
  });

  it("exits 2 naming both sign-ins when no organization is named", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("Acme");
    expect(stderr).toContain("Globex");
    expect(stderr).toContain("--organization");
    expect(projectRequestTokens(adminApi)).toEqual([]);
  });

  it("exits 2 naming the sign-ins there are when the named organization has none", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl, ["--organization", "Initech"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain('"Initech"');
    expect(stderr).toContain("Acme");
    expect(stderr).toContain("Globex");
    expect(projectRequestTokens(adminApi)).toEqual([]);
  });

  it("exits 2 as a usage error when --organization is given together with CONFIGDIRECTOR_TOKEN", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl, ["--organization", "globex"], {
      CONFIGDIRECTOR_TOKEN: "cd_globex_token",
    });

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("--organization");
    expect(stderr).toContain("CONFIGDIRECTOR_TOKEN");
    expect(projectRequestTokens(adminApi)).toEqual([]);
  });
});

describe("the token saved by an earlier version", () => {
  it("becomes the sign-in for its organization with one GET /api-token, and config.json is deleted", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await writeConfigJson(sandbox, "cd_acme_token");

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(adminApi.receivedRequests.map((request) => [request.path, request.headers.authorization])).toEqual(
      [
        ["/v1/api-token", "Bearer cd_acme_token"],
        ["/v1/projects", "Bearer cd_acme_token"],
      ],
    );
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
    expect(await readdir(userConfigDirectoryOf(sandbox))).toEqual(["sign-ins.json"]);
  });

  it("is deleted without becoming a sign-in, with a line on stderr, when the API rejects it", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await writeConfigJson(sandbox, "cd_revoked_token");

    const { exitCode, stderr } = await listProjects(sandbox, adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(join(userConfigDirectoryOf(sandbox), "config.json"));
    expect(stderr).toContain("API_TOKEN_NOT_FOUND");
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual(["/v1/api-token"]);
    expect(await readdir(userConfigDirectoryOf(sandbox))).toEqual([]);
  });

  it("stays in config.json for the next run when the Admin API cannot be reached", async () => {
    const sandbox = await createSandbox();
    await writeConfigJson(sandbox, "cd_acme_token");

    const { exitCode, stderr } = await listProjects(sandbox, "http://127.0.0.1:1");

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("Could not reach the Admin API");
    expect(await readFile(join(userConfigDirectoryOf(sandbox), "config.json"), "utf8")).toEqual(
      '{"token":"cd_acme_token"}\n',
    );
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });

  it("is neither read nor moved by a command whose token comes from CONFIGDIRECTOR_TOKEN", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    await writeConfigJson(sandbox, "cd_old_token");

    const { exitCode } = await listProjects(sandbox, adminApi.baseUrl, [], {
      CONFIGDIRECTOR_TOKEN: "cd_acme_token",
    });

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual(["/v1/projects"]);
    expect(await readdir(userConfigDirectoryOf(sandbox))).toEqual(["config.json"]);
  });

  it("is moved into a sign-in by login before the pasted token is saved", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await writeConfigJson(sandbox, "cd_acme_token");

    await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");

    expect(adminApi.receivedRequests.map((request) => [request.path, request.headers.authorization])).toEqual(
      [
        ["/v1/api-token", "Bearer cd_globex_token"],
        ["/v1/api-token", "Bearer cd_acme_token"],
      ],
    );
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [
        { organization: acme, token: "cd_acme_token" },
        { organization: globex, token: "cd_globex_token" },
      ],
    });
    expect(await readdir(userConfigDirectoryOf(sandbox))).toEqual(["sign-ins.json"]);
  });
});
