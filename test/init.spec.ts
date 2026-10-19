import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import {
  acme,
  acmeWebApp,
  globex,
  globexWebApp,
  logIn,
  projectOf,
  startSignInAdminApi,
} from "./support/sign-in-admin-api.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const webApp = {
  ...acmeWebApp,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const mobileApp = {
  ...projectOf(acme, "mobile-app", "Mobile App", "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918"),
  createdAt: "2026-09-02T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
};

const globexMobileApp = projectOf(globex, "mobile-app", "Mobile App", "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f");

const acmeAccount = { token: "cd_acme_token", organization: acme, projects: [acmeWebApp, mobileApp] };

const globexAccount = { token: "cd_globex_token", organization: globex, projects: [globexWebApp] };

const settingsFileOf = (sandbox: Sandbox) => join(sandbox.workingDirectory, "configdirector.json");

const readSettings = async (sandbox: Sandbox) => JSON.parse(await readFile(settingsFileOf(sandbox), "utf8"));

const init = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[],
  environmentVariables: Record<string, string> = {},
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: ["init", ...commandLineArguments],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl, ...environmentVariables },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const projectRequestTokens = (adminApi: Awaited<ReturnType<typeof startStubAdminApi>>) =>
  adminApi.receivedRequests
    .filter((request) => request.path === "/v1/projects")
    .map((request) => request.headers.authorization);

describe("init", () => {
  it("writes configdirector.json linking the project given with --project and its organization's id, even when CONFIGDIRECTOR_PROJECT names another", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await init(
      sandbox,
      adminApi.baseUrl,
      ["--project", "web-app", "--token", "cd_flag_token"],
      {
        CONFIGDIRECTOR_PROJECT: "mobile-app",
      },
    );

    expect(exitCode).toEqual(0);
    expect(stdout).toEqual(
      `Linked this directory to the project Web App (web-app) of the organization ${acme.id} in ${settingsFileOf(sandbox)}\n`,
    );
    expect(await readFile(settingsFileOf(sandbox), "utf8")).toEqual(
      `${JSON.stringify({ project: "web-app", organization: acme.id, include: ["**"], exclude: [], ignoreKeys: [] }, null, 2)}\n`,
    );
  });

  it("links the project named by CONFIGDIRECTOR_PROJECT when no --project is given", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();

    const { exitCode } = await init(sandbox, adminApi.baseUrl, ["--token", "cd_flag_token"], {
      CONFIGDIRECTOR_PROJECT: "mobile-app",
    });

    expect(exitCode).toEqual(0);
    expect(await readSettings(sandbox)).toEqual({
      project: "mobile-app",
      organization: acme.id,
      include: ["**"],
      exclude: [],
      ignoreKeys: [],
    });
  });

  it("exits 2 without calling the Admin API or writing a file when no project is given", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();

    const { exitCode, stderr } = await init(sandbox, adminApi.baseUrl, ["--token", "cd_flag_token"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("--project");
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await readdir(sandbox.workingDirectory)).toEqual([]);
  });

  it("exits 2 without writing a file when no project in the token's organization has the slug", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();

    const { exitCode, stderr } = await init(sandbox, adminApi.baseUrl, [
      "--project",
      "checkout-service",
      "--token",
      "cd_flag_token",
    ]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("checkout-service");
    expect(await readdir(sandbox.workingDirectory)).toEqual([]);
  });

  it("exits 2 and leaves an existing configdirector.json that names an organization untouched", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const existingSettings = `{ "project": "mobile-app", "organization": "${acme.id}", "include": ["app/**"] }\n`;
    await writeFile(settingsFileOf(sandbox), existingSettings);

    const { exitCode, stderr } = await init(sandbox, adminApi.baseUrl, ["--token", "cd_flag_token"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("configdirector.json");
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await readFile(settingsFileOf(sandbox), "utf8")).toEqual(existingSettings);
  });

  it("adds the organization to an existing configdirector.json without one, taking the slug from the file and keeping its other fields", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    await writeFile(
      settingsFileOf(sandbox),
      '{ "project": "mobile-app", "include": ["app/**"], "ignoreKeys": ["billing"], "patterns": ["kept"] }\n',
    );

    const { exitCode, stdout } = await init(sandbox, adminApi.baseUrl, ["--token", "cd_flag_token"]);

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("Mobile App (mobile-app)");
    expect(await readFile(settingsFileOf(sandbox), "utf8")).toEqual(
      `${JSON.stringify(
        {
          project: "mobile-app",
          organization: acme.id,
          include: ["app/**"],
          ignoreKeys: ["billing"],
          patterns: ["kept"],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("exits 2 leaving an existing configdirector.json untouched when --project names another project than the file", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const existingSettings = '{ "project": "mobile-app", "include": ["app/**"] }\n';
    await writeFile(settingsFileOf(sandbox), existingSettings);

    const { exitCode, stderr } = await init(sandbox, adminApi.baseUrl, [
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
    ]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("mobile-app");
    expect(stderr).toContain("web-app");
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await readFile(settingsFileOf(sandbox), "utf8")).toEqual(existingSettings);
  });

  it("prints only JSON on stdout with --json, naming the written file, the project the slug resolved to and its organization's id", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();

    const { exitCode, stdout } = await init(sandbox, adminApi.baseUrl, [
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(stdout)).toEqual({
      settingsFile: settingsFileOf(sandbox),
      project: { id: acmeWebApp.id, slug: "web-app", name: "Web App" },
      organizationId: acme.id,
    });
  });
});

describe("init with CLI sign-ins", () => {
  const signInToBoth = async (sandbox: Sandbox, baseUrl: string) => {
    await logIn(sandbox, baseUrl, "cd_acme_token");
    await logIn(sandbox, baseUrl, "cd_globex_token");
  };

  it("looks for the slug through every sign-in and writes the organization of the one that has it, named by its saved name", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stdout, stderr } = await init(sandbox, adminApi.baseUrl, ["--project", "mobile-app"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout).toEqual(
      `Linked this directory to the project Mobile App (mobile-app) of the organization Acme in ${settingsFileOf(sandbox)}\n`,
    );
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_acme_token", "Bearer cd_globex_token"]);
    expect(await readSettings(sandbox)).toEqual({
      project: "mobile-app",
      organization: acme.id,
      include: ["**"],
      exclude: [],
      ignoreKeys: [],
    });
  });

  it("exits 2 naming both organizations and asking for --organization when two sign-ins have the slug", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stderr } = await init(sandbox, adminApi.baseUrl, ["--project", "web-app"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("Acme");
    expect(stderr).toContain("Globex");
    expect(stderr).toContain("--organization");
    expect(await readdir(sandbox.workingDirectory)).toEqual([]);
  });

  it("exits 2 naming the sign-ins searched when no sign-in has the slug", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stderr } = await init(sandbox, adminApi.baseUrl, ["--project", "checkout-service"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain('"checkout-service"');
    expect(stderr).toContain("Acme");
    expect(stderr).toContain("Globex");
    expect(await readdir(sandbox.workingDirectory)).toEqual([]);
  });

  it("looks only through the sign-in --organization names", async () => {
    const adminApi = await startSignInAdminApi([
      acmeAccount,
      { ...globexAccount, projects: [globexWebApp, globexMobileApp] },
    ]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode } = await init(sandbox, adminApi.baseUrl, [
      "--project",
      "mobile-app",
      "--organization",
      "globex",
    ]);

    expect(exitCode).toEqual(0);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_globex_token"]);
    expect(await readSettings(sandbox)).toEqual({
      project: "mobile-app",
      organization: globex.id,
      include: ["**"],
      exclude: [],
      ignoreKeys: [],
    });
  });

  it("looks only through CONFIGDIRECTOR_TOKEN when it is set, and names the organization by its id", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await signInToBoth(sandbox, adminApi.baseUrl);

    const { exitCode, stdout } = await init(sandbox, adminApi.baseUrl, ["--project", "web-app"], {
      CONFIGDIRECTOR_TOKEN: "cd_globex_token",
    });

    expect(exitCode).toEqual(0);
    expect(stdout).toContain(`of the organization ${globex.id} in`);
    expect(projectRequestTokens(adminApi)).toEqual(["Bearer cd_globex_token"]);
    expect(await readSettings(sandbox)).toEqual({
      project: "web-app",
      organization: globex.id,
      include: ["**"],
      exclude: [],
      ignoreKeys: [],
    });
  });

  it("exits 2 naming CONFIGDIRECTOR_TOKEN and login without a request when there is no sign-in", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stderr } = await init(sandbox, adminApi.baseUrl, ["--project", "web-app"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("CONFIGDIRECTOR_TOKEN");
    expect(stderr).toContain("configdirector login");
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await readdir(sandbox.workingDirectory)).toEqual([]);
  });
});
