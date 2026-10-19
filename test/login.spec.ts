import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import {
  acme,
  globex,
  readSignInsFile,
  signInsFileExists,
  startSignInAdminApi,
  userConfigDirectoryOf,
} from "./support/sign-in-admin-api.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";
import { createTerminalInput } from "./support/terminal-input.js";

const acmeAccount = { token: "cd_acme_token", organization: acme };

const globexAccount = { token: "cd_globex_token", organization: globex };

const logIn = async (
  sandbox: Sandbox,
  baseUrl: string,
  token: string,
  commandLineArguments: string[] = [],
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: ["login", ...commandLineArguments],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
    stdin: Readable.from([`${token}\n`]),
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

describe("login", () => {
  it("saves the pasted token as the sign-in for its organization, readable only by the user, after one GET /api-token", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const signInsFile = join(userConfigDirectoryOf(sandbox), "sign-ins.json");
    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("Paste your API token: ");
    expect(stdout).toEqual(`Signed in to Acme. The CLI sign-in is saved in ${signInsFile}\n`);
    expect(adminApi.receivedRequests.map((request) => [request.path, request.headers.authorization])).toEqual(
      [["/v1/api-token", "Bearer cd_acme_token"]],
    );
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
    expect((await stat(signInsFile)).mode & 0o777).toEqual(0o600);
    expect(await readdir(userConfigDirectoryOf(sandbox))).toEqual(["sign-ins.json"]);
  });

  it("keeps a sign-in for each of two organizations", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount, globexAccount]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    const { exitCode, stdout } = await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");

    expect(exitCode).toEqual(0);
    expect(stdout).toContain("Signed in to Globex.");
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [
        { organization: acme, token: "cd_acme_token" },
        { organization: globex, token: "cd_globex_token" },
      ],
    });
  });

  it("replaces the organization's sign-in and refreshes its saved name on a second login for the same organization", async () => {
    const adminApi = await startSignInAdminApi([
      acmeAccount,
      globexAccount,
      { token: "cd_acme_newer_token", organization: { ...acme, name: "Acme Corporation" } },
    ]);
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");
    await logIn(sandbox, adminApi.baseUrl, "cd_globex_token");

    const { exitCode } = await logIn(sandbox, adminApi.baseUrl, "cd_acme_newer_token");

    expect(exitCode).toEqual(0);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [
        { organization: { ...acme, name: "Acme Corporation" }, token: "cd_acme_newer_token" },
        { organization: globex, token: "cd_globex_token" },
      ],
    });
  });

  it("exits 2 naming projects:read and saves nothing when the token lacks it, with no second request", async () => {
    const adminApi = await startSignInAdminApi([
      { token: "cd_configs_only_token", organization: acme, permissions: ["configs:read"] },
    ]);
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await logIn(sandbox, adminApi.baseUrl, "cd_configs_only_token");

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("projects:read");
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual(["/v1/api-token"]);
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });

  it("exits 2 showing the API's error code and saves nothing when the token is rejected", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stderr } = await logIn(sandbox, adminApi.baseUrl, "cd_revoked_token");

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("API_TOKEN_NOT_FOUND");
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });

  it("saves a sign-in from the --token value without reading the prompt", async () => {
    const adminApi = await startSignInAdminApi([
      acmeAccount,
      { token: "cd_flag_token", organization: globex },
    ]);
    const sandbox = await createSandbox();

    const { exitCode } = await logIn(sandbox, adminApi.baseUrl, "cd_acme_token", [
      "--token",
      "cd_flag_token",
    ]);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.headers.authorization)).toEqual([
      "Bearer cd_flag_token",
    ]);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: globex, token: "cd_flag_token" }],
    });
  });

  it("exits 2 as a usage error without a request or a saved sign-in when --organization is given", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode, stderr } = await logIn(sandbox, adminApi.baseUrl, "cd_acme_token", [
      "--token",
      "cd_acme_token",
      "--organization",
      "Acme",
    ]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("--organization");
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });

  it("saves the pasted token rather than CONFIGDIRECTOR_TOKEN", async () => {
    const adminApi = await startSignInAdminApi([
      acmeAccount,
      { token: "cd_variable_token", organization: globex },
    ]);
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        CONFIGDIRECTOR_TOKEN: "cd_variable_token",
      },
      stdin: Readable.from(["cd_acme_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
  });

  it("exits 2 without calling the Admin API or saving anything when nothing is pasted", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();

    const { exitCode } = await logIn(sandbox, adminApi.baseUrl, "   ");

    expect(exitCode).toEqual(2);
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });

  it("reads a token typed at a terminal with echo turned off, and turns echo back on", async () => {
    const adminApi = await startSignInAdminApi([{ token: "cd_typed_token", organization: acme }]);
    const sandbox = await createSandbox();
    const terminal = createTerminalInput("cd_typed_token\r");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: terminal.input,
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(terminal.rawModeChanges).toEqual([true, false]);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: acme, token: "cd_typed_token" }],
    });
  });

  it("exits 2 without calling the Admin API and turns echo back on when Ctrl-C is pressed at the prompt", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const terminal = createTerminalInput("cd_typ\u0003");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: terminal.input,
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(terminal.rawModeChanges).toEqual([true, false]);
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });

  it("removes the last typed character for each Backspace at the prompt", async () => {
    const adminApi = await startSignInAdminApi([{ token: "cd_typed_token", organization: acme }]);
    const sandbox = await createSandbox();
    const terminal = createTerminalInput("cd_typed_tokxx\u007f\u007fen\r");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: terminal.input,
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [{ organization: acme, token: "cd_typed_token" }],
    });
  });

  it("makes a sign-ins file that others could read readable only by the user when logging in again", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const signInsFile = join(userConfigDirectoryOf(sandbox), "sign-ins.json");
    await mkdir(userConfigDirectoryOf(sandbox), { recursive: true });
    await writeFile(
      signInsFile,
      JSON.stringify({ signIns: [{ organization: globex, token: "cd_old_token" }] }),
      {
        mode: 0o644,
      },
    );

    const { exitCode } = await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    expect(exitCode).toEqual(0);
    expect(await readSignInsFile(sandbox)).toEqual({
      signIns: [
        { organization: globex, token: "cd_old_token" },
        { organization: acme, token: "cd_acme_token" },
      ],
    });
    expect((await stat(signInsFile)).mode & 0o777).toEqual(0o600);
  });

  it("exits 2 naming the sign-ins file when it is not valid", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const signInsFile = join(userConfigDirectoryOf(sandbox), "sign-ins.json");
    await mkdir(userConfigDirectoryOf(sandbox), { recursive: true });
    await writeFile(signInsFile, '{ "signIns": ');

    const { exitCode, stderr } = await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(signInsFile);
    expect(await readFile(signInsFile, "utf8")).toEqual('{ "signIns": ');
  });

  it("saves the sign-in under XDG_CONFIG_HOME when it is set", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const configHome = join(sandbox.root, "xdg-config");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl, XDG_CONFIG_HOME: configHome },
      stdin: Readable.from(["cd_acme_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(join(configHome, "configdirector", "sign-ins.json"), "utf8"))).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
  });

  it("saves the sign-in under Library/Application Support in the home directory on macOS", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      platform: "darwin",
      stdin: Readable.from(["cd_acme_token\n"]),
    });

    const exitCode = await run(invocation);

    const signInsFile = join(
      sandbox.homeDirectory,
      "Library",
      "Application Support",
      "configdirector",
      "sign-ins.json",
    );
    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(signInsFile, "utf8"))).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
  });

  it("saves the sign-in under APPDATA on Windows", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const applicationData = join(sandbox.root, "AppData", "Roaming");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl, APPDATA: applicationData },
      platform: "win32",
      stdin: Readable.from(["cd_acme_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(
      JSON.parse(await readFile(join(applicationData, "configdirector", "sign-ins.json"), "utf8")),
    ).toEqual({ signIns: [{ organization: acme, token: "cd_acme_token" }] });
  });

  it("saves the sign-in under AppData/Roaming in the home directory on Windows when APPDATA is unset", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      platform: "win32",
      stdin: Readable.from(["cd_acme_token\n"]),
    });

    const exitCode = await run(invocation);

    const signInsFile = join(sandbox.homeDirectory, "AppData", "Roaming", "configdirector", "sign-ins.json");
    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(signInsFile, "utf8"))).toEqual({
      signIns: [{ organization: acme, token: "cd_acme_token" }],
    });
  });

  it("prints only JSON naming the sign-ins file and the organization on stdout with --json", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login", "--json"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: Readable.from(["cd_acme_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(invocation.stdout.text())).toEqual({
      signInsFile: join(sandbox.homeDirectory, ".config", "configdirector", "sign-ins.json"),
      organization: acme,
    });
  });

  it("exits 2 reporting the failure when the sign-ins file cannot be written", async () => {
    const adminApi = await startSignInAdminApi([acmeAccount]);
    const sandbox = await createSandbox();
    const regularFile = join(sandbox.root, "not-a-directory");
    await writeFile(regularFile, "");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        XDG_CONFIG_HOME: join(regularFile, "config"),
      },
      stdin: Readable.from(["cd_acme_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain(regularFile);
  });

  it("exits 2 showing the API's error code when the API answers GET /api-token with a response the CLI cannot read", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: { unexpected: true } });
    const sandbox = await createSandbox();

    const { exitCode, stderr } = await logIn(sandbox, adminApi.baseUrl, "cd_acme_token");

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("/v1/api-token");
    expect(await signInsFileExists(sandbox)).toEqual(false);
  });
});
