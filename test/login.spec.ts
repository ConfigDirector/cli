import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox } from "./support/sandbox.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";
import { createTerminalInput } from "./support/terminal-input.js";

const webApp = {
  id: "4f0c1d2e-8a51-4c3b-9b6e-2d7f8a9b0c1d",
  name: "Web App",
  slug: "web-app",
  organizationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const readSavedToken = async (homeDirectory: string) =>
  JSON.parse(await readFile(join(homeDirectory, ".config", "configdirector", "config.json"), "utf8"));

const savedTokenFileExists = async (homeDirectory: string) =>
  access(join(homeDirectory, ".config", "configdirector", "config.json")).then(
    () => true,
    () => false,
  );

describe("login", () => {
  it("saves the pasted token readable only by the user once the project listing accepts it", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    const savedFile = join(sandbox.homeDirectory, ".config", "configdirector", "config.json");
    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => [request.path, request.headers.authorization])).toEqual(
      [["/v1/projects", "Bearer cd_pasted_token"]],
    );
    expect(JSON.parse(await readFile(savedFile, "utf8"))).toEqual({ token: "cd_pasted_token" });
    expect((await stat(savedFile)).mode & 0o777).toEqual(0o600);
  });

  it("exits 2 showing the API's error code and saves nothing when the token is rejected", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: {
        error:
          "No API token matches the bearer token. It may have been deleted or its organization disabled.",
        code: "API_TOKEN_NOT_FOUND",
      },
    });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: Readable.from(["cd_revoked_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("API_TOKEN_NOT_FOUND");
    expect(await savedTokenFileExists(sandbox.homeDirectory)).toEqual(false);
  });

  it("verifies and saves the --token value without reading the prompt", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.headers.authorization)).toEqual([
      "Bearer cd_flag_token",
    ]);
    expect(await readSavedToken(sandbox.homeDirectory)).toEqual({ token: "cd_flag_token" });
  });

  it("saves the pasted token rather than CONFIGDIRECTOR_TOKEN", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        CONFIGDIRECTOR_TOKEN: "cd_variable_token",
      },
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(await readSavedToken(sandbox.homeDirectory)).toEqual({ token: "cd_pasted_token" });
  });

  it("exits 2 without calling the Admin API or saving anything when nothing is pasted", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: Readable.from(["   \n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await savedTokenFileExists(sandbox.homeDirectory)).toEqual(false);
  });

  it("reads a token typed at a terminal with echo turned off, and turns echo back on", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
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
    expect(await readSavedToken(sandbox.homeDirectory)).toEqual({ token: "cd_typed_token" });
  });

  it("exits 2 without calling the Admin API and turns echo back on when Ctrl-C is pressed at the prompt", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
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
    expect(await savedTokenFileExists(sandbox.homeDirectory)).toEqual(false);
  });

  it("removes the last typed character for each Backspace at the prompt", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const terminal = createTerminalInput("cd_typed_tokxx\u007f\u007fen\r");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: terminal.input,
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(await readSavedToken(sandbox.homeDirectory)).toEqual({ token: "cd_typed_token" });
  });

  it("makes a saved token file that others could read readable only by the user when logging in again", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const savedFile = join(sandbox.homeDirectory, ".config", "configdirector", "config.json");
    await mkdir(join(sandbox.homeDirectory, ".config", "configdirector"), { recursive: true });
    await writeFile(savedFile, '{ "token": "cd_old_token" }\n', { mode: 0o644 });
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(await readSavedToken(sandbox.homeDirectory)).toEqual({ token: "cd_pasted_token" });
    expect((await stat(savedFile)).mode & 0o777).toEqual(0o600);
  });

  it("saves the token under XDG_CONFIG_HOME when it is set", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const configHome = join(sandbox.root, "xdg-config");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl, XDG_CONFIG_HOME: configHome },
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(join(configHome, "configdirector", "config.json"), "utf8"))).toEqual({
      token: "cd_pasted_token",
    });
  });

  it("saves the token under Library/Application Support in the home directory on macOS", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      platform: "darwin",
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    const savedFile = join(
      sandbox.homeDirectory,
      "Library",
      "Application Support",
      "configdirector",
      "config.json",
    );
    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(savedFile, "utf8"))).toEqual({ token: "cd_pasted_token" });
  });

  it("saves the token under APPDATA on Windows", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const applicationData = join(sandbox.root, "AppData", "Roaming");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl, APPDATA: applicationData },
      platform: "win32",
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(
      JSON.parse(await readFile(join(applicationData, "configdirector", "config.json"), "utf8")),
    ).toEqual({
      token: "cd_pasted_token",
    });
  });

  it("saves the token under AppData/Roaming in the home directory on Windows when APPDATA is unset", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      platform: "win32",
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    const savedFile = join(sandbox.homeDirectory, "AppData", "Roaming", "configdirector", "config.json");
    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(savedFile, "utf8"))).toEqual({ token: "cd_pasted_token" });
  });

  it("prints only JSON naming the saved token file on stdout with --json", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["login", "--json"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(invocation.stdout.text())).toEqual({
      tokenFile: join(sandbox.homeDirectory, ".config", "configdirector", "config.json"),
    });
  });

  it("exits 2 reporting the failure when the token file cannot be written", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const regularFile = join(sandbox.root, "not-a-directory");
    await writeFile(regularFile, "");
    const invocation = sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        XDG_CONFIG_HOME: join(regularFile, "config"),
      },
      stdin: Readable.from(["cd_pasted_token\n"]),
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain(regularFile);
  });
});
