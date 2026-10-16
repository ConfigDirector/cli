import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox } from "./support/sandbox.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const webApp = {
  id: "4f0c1d2e-8a51-4c3b-9b6e-2d7f8a9b0c1d",
  name: "Web App",
  slug: "web-app",
  organizationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const mobileApp = {
  id: "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918",
  name: "Mobile App",
  slug: "mobile-app",
  organizationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  createdAt: "2026-09-02T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
};

describe("init", () => {
  it("writes configdirector.json linking the project given with --project, even when CONFIGDIRECTOR_PROJECT names another", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app", "--token", "cd_flag_token"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        CONFIGDIRECTOR_PROJECT: "mobile-app",
      },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(join(sandbox.workingDirectory, "configdirector.json"), "utf8"))).toEqual(
      {
        project: "web-app",
        include: ["**"],
        exclude: [],
        ignoreKeys: [],
      },
    );
  });

  it("links the project named by CONFIGDIRECTOR_PROJECT when no --project is given", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--token", "cd_flag_token"],
      environmentVariables: {
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
        CONFIGDIRECTOR_PROJECT: "mobile-app",
      },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(await readFile(join(sandbox.workingDirectory, "configdirector.json"), "utf8"))).toEqual(
      {
        project: "mobile-app",
        include: ["**"],
        exclude: [],
        ignoreKeys: [],
      },
    );
  });

  it("exits 2 without calling the Admin API or writing a file when no project is given", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("--project");
    expect(adminApi.receivedRequests).toEqual([]);
    expect(await readdir(sandbox.workingDirectory)).toEqual([]);
  });

  it("exits 2 without writing a file when no project in the organization has the slug", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "checkout-service", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("checkout-service");
    expect(await readdir(sandbox.workingDirectory)).toEqual([]);
  });

  it("exits 2 and leaves an existing configdirector.json untouched", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const settingsFile = join(sandbox.workingDirectory, "configdirector.json");
    const existingSettings = '{ "project": "mobile-app", "include": ["app/**"] }\n';
    await writeFile(settingsFile, existingSettings);
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("configdirector.json");
    expect(await readFile(settingsFile, "utf8")).toEqual(existingSettings);
  });

  it("reports an existing configdirector.json before asking for a project or calling the Admin API", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    await writeFile(join(sandbox.workingDirectory, "configdirector.json"), '{ "project": "mobile-app" }\n');
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stderr.text()).toContain("configdirector.json");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("prints only JSON on stdout with --json, naming the written file and the project the slug resolved to", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [mobileApp, webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: ["init", "--project", "web-app", "--token", "cd_flag_token", "--json"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(invocation.stdout.text())).toEqual({
      settingsFile: join(sandbox.workingDirectory, "configdirector.json"),
      project: { id: "4f0c1d2e-8a51-4c3b-9b6e-2d7f8a9b0c1d", slug: "web-app", name: "Web App" },
    });
  });
});
