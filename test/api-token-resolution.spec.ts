import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const webApp = {
  id: "4f0c1d2e-8a51-4c3b-9b6e-2d7f8a9b0c1d",
  name: "Web App",
  slug: "web-app",
  organizationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const logIn = async (sandbox: Sandbox, baseUrl: string, token: string) => {
  await run(
    sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
      stdin: Readable.from([`${token}\n`]),
    }),
  );
};

describe("API token resolution", () => {
  it("sends the --token value even when CONFIGDIRECTOR_TOKEN is set and a token is saved", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_saved_token");
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app", "--token", "cd_flag_token"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        CONFIGDIRECTOR_TOKEN: "cd_variable_token",
      },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.headers.authorization)).toEqual([
      "Bearer cd_saved_token",
      "Bearer cd_flag_token",
    ]);
  });

  it("sends CONFIGDIRECTOR_TOKEN when no --token is given, even when a token is saved", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_saved_token");
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        CONFIGDIRECTOR_TOKEN: "cd_variable_token",
      },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.headers.authorization)).toEqual([
      "Bearer cd_saved_token",
      "Bearer cd_variable_token",
    ]);
  });

  it("exits 2 naming CONFIGDIRECTOR_TOKEN without calling the Admin API when no token is found", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("CONFIGDIRECTOR_TOKEN");
    expect(invocation.stdout.text()).toEqual("");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("sends the token saved by login when neither --token nor CONFIGDIRECTOR_TOKEN is set", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_saved_token");
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.headers.authorization)).toEqual([
      "Bearer cd_saved_token",
      "Bearer cd_saved_token",
    ]);
  });

  it("treats an empty CONFIGDIRECTOR_TOKEN as unset and sends the saved token", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    await logIn(sandbox, adminApi.baseUrl, "cd_saved_token");
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl, CONFIGDIRECTOR_TOKEN: "" },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.headers.authorization)).toEqual([
      "Bearer cd_saved_token",
      "Bearer cd_saved_token",
    ]);
  });

  it("exits 2 naming the saved token file when it is not valid", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const savedFile = join(sandbox.homeDirectory, ".config", "configdirector", "config.json");
    await mkdir(join(sandbox.homeDirectory, ".config", "configdirector"), { recursive: true });
    await writeFile(savedFile, '{ "token": ');
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain(savedFile);
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
