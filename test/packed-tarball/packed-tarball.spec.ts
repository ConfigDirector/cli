import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBrowseAdminApi } from "../support/browse-admin-api.js";
import { productionEnvironment, startEvaluateAdminApi } from "../support/evaluate-admin-api.js";
import { startScanAdminApi, webApp } from "../support/scan-admin-api.js";
import { startStubAdminApi } from "../support/stub-admin-api.js";

const execFileAsync = promisify(execFile);

const tarball = fileURLToPath(new URL("../../package.tgz", import.meta.url));

let installDirectory: string;

const installedBinary = () => join(installDirectory, "node_modules", ".bin", "configdirector");

const runInstalledBinary = (
  commandLineArguments: string[],
  options: { environmentVariables: Record<string, string>; input: string },
) =>
  new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(installedBinary(), commandLineArguments, {
      cwd: installDirectory,
      env: { PATH: process.env.PATH ?? "", ...options.environmentVariables },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(options.input);
  });

beforeAll(async () => {
  await access(tarball).catch(() => {
    throw new Error(`${tarball} is missing. Run \`yarn build && yarn pack:tarball\` first.`);
  });
  installDirectory = await mkdtemp(join(tmpdir(), "configdirector-cli-tarball-"));
  await writeFile(join(installDirectory, "package.json"), JSON.stringify({ private: true }));
  await execFileAsync("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", tarball], {
    cwd: installDirectory,
  });
});

afterAll(async () => {
  await rm(installDirectory, { recursive: true, force: true });
});

describe("the packed tarball installed into an empty directory", () => {
  it("prints the installed package's version", async () => {
    const installedPackage = JSON.parse(
      await readFile(
        join(installDirectory, "node_modules", "@configdirector", "cli", "package.json"),
        "utf8",
      ),
    );

    const result = await runInstalledBinary(["--version"], { environmentVariables: {}, input: "" });

    expect(result.exitCode).toEqual(0);
    expect(result.stdout).toEqual(`${installedPackage.version}\n`);
  });

  it("logs in against a stub Admin API and saves the token", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const homeDirectory = join(installDirectory, "home");
    await mkdir(homeDirectory, { recursive: true });

    const result = await runInstalledBinary(["login"], {
      environmentVariables: {
        HOME: homeDirectory,
        XDG_CONFIG_HOME: join(homeDirectory, ".config"),
        CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
      },
      input: "cd_pasted_token\n",
    });

    expect(result.exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.headers.authorization)).toEqual([
      "Bearer cd_pasted_token",
    ]);
    expect(
      JSON.parse(await readFile(join(homeDirectory, ".config", "configdirector", "config.json"), "utf8")),
    ).toEqual({ token: "cd_pasted_token" });
  });

  it("scans the current directory for SDK calls against a stub Admin API", async () => {
    const adminApi = await startScanAdminApi();
    await mkdir(join(installDirectory, "src"), { recursive: true });
    await writeFile(
      join(installDirectory, "src", "checkout.ts"),
      'import { createClient } from "@configdirector/server-sdk";\n\ncreateClient("key").getValue("new-checkout", false);\n',
    );

    const result = await runInstalledBinary(
      ["scan", "--project", "web-app", "--token", "cd_flag_token", "--json"],
      {
        environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
        input: "",
      },
    );

    expect(result.exitCode).toEqual(0);
    expect(JSON.parse(result.stdout).references).toEqual([
      {
        key: "new-checkout",
        file: "src/checkout.ts",
        line: 3,
        kind: "direct",
        sdk: "js-server",
        call: "getValue",
        default: { type: "boolean", value: false },
        test: false,
      },
    ]);
  });

  it("evaluates a config for an inline context against a stub Admin API", async () => {
    const adminApi = await startEvaluateAdminApi();

    const result = await runInstalledBinary(
      [
        "evaluate",
        "new-checkout",
        "--environment",
        "production",
        "--context-id",
        "123",
        "--context-trait",
        "beta:=true",
        "--project",
        "web-app",
        "--token",
        "cd_flag_token",
      ],
      {
        environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
        input: "",
      },
    );

    expect(result.exitCode).toEqual(0);
    expect(result.stdout.split("\n").slice(0, 3)).toEqual([
      "new-checkout in Production for user 123",
      "",
      "true, served by rule 2",
    ]);
    expect(adminApi.receivedRequests.at(-1)?.body).toEqual({
      environmentId: productionEnvironment.id,
      context: { kind: "user", identifier: "123", traits: { beta: true } },
    });
  });

  it("lists a project's environments against a stub Admin API", async () => {
    const adminApi = await startBrowseAdminApi();

    const result = await runInstalledBinary(
      ["environments", "list", "--project", "web-app", "--token", "cd_flag_token"],
      {
        environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
        input: "",
      },
    );

    expect(result.exitCode).toEqual(0);
    expect(result.stdout.split("\n")).toEqual(["test         Test", "production   Production   live", ""]);
  });

  it("ships the JSON Schema of the scan output", async () => {
    const schema = JSON.parse(
      await readFile(
        join(installDirectory, "node_modules", "@configdirector", "cli", "schema", "scan-output.schema.json"),
        "utf8",
      ),
    );

    expect(schema.title).toEqual("configdirector scan and validate --json output");
  });
});
