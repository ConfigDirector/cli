import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { startBrowseAdminApi } from "../support/browse-admin-api.js";
import { productionEnvironment, startEvaluateAdminApi } from "../support/evaluate-admin-api.js";
import { startScanAdminApi } from "../support/scan-admin-api.js";
import { acme, startSignInAdminApi } from "../support/sign-in-admin-api.js";

const execFileAsync = promisify(execFile);

const tarball = fileURLToPath(new URL("../../package.tgz", import.meta.url));

const licenseTextInRepository = (packageName: string, licenseFileName: string) =>
  readFile(
    fileURLToPath(new URL(`../../node_modules/${packageName}/${licenseFileName}`, import.meta.url)),
    "utf8",
  );

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

  it("logs in against a stub Admin API and saves the sign-in", async () => {
    const adminApi = await startSignInAdminApi([{ token: "cd_pasted_token", organization: acme }]);
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
    expect(adminApi.receivedRequests.map((request) => [request.path, request.headers.authorization])).toEqual(
      [["/v1/api-token", "Bearer cd_pasted_token"]],
    );
    expect(
      JSON.parse(await readFile(join(homeDirectory, ".config", "configdirector", "sign-ins.json"), "utf8")),
    ).toEqual({ signIns: [{ organization: acme, token: "cd_pasted_token" }] });
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
        snippet: {
          firstLine: 1,
          lines: [
            'import { createClient } from "@configdirector/server-sdk";',
            "",
            'createClient("key").getValue("new-checkout", false);',
          ],
          language: "typescript",
          truncatedLines: [],
        },
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

  it("ships the license of every package built into it", async () => {
    const thirdPartyLicenses = await readFile(
      join(installDirectory, "node_modules", "@configdirector", "cli", "dist", "THIRD-PARTY-LICENSES.md"),
      "utf8",
    );

    const packageHeadings = thirdPartyLicenses
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice("## ".length).split(" ")[0]);
    expect(packageHeadings).toEqual(["commander", "ignore", "picomatch", "valibot"]);
    expect(thirdPartyLicenses).toContain(await licenseTextInRepository("commander", "LICENSE"));
    expect(thirdPartyLicenses).toContain(await licenseTextInRepository("ignore", "LICENSE-MIT"));
    expect(thirdPartyLicenses).toContain(await licenseTextInRepository("picomatch", "LICENSE"));
    expect(thirdPartyLicenses).toContain(await licenseTextInRepository("valibot", "LICENSE.md"));
  });
});

describe("the packed tarball installed under an npm release-age gate", () => {
  it("installs and runs when npm's before setting holds back every published package", async () => {
    const gatedDirectory = await mkdtemp(join(tmpdir(), "configdirector-cli-gated-"));
    onTestFinished(() => rm(gatedDirectory, { recursive: true, force: true }));
    await writeFile(join(gatedDirectory, "package.json"), JSON.stringify({ private: true }));
    await writeFile(join(gatedDirectory, ".npmrc"), "before=2000-01-01T00:00:00.000Z\n");

    await execFileAsync("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", tarball], {
      cwd: gatedDirectory,
    });

    const { stdout } = await execFileAsync(join(gatedDirectory, "node_modules", ".bin", "configdirector"), [
      "--version",
    ]);
    const installedPackage = JSON.parse(
      await readFile(join(gatedDirectory, "node_modules", "@configdirector", "cli", "package.json"), "utf8"),
    );
    expect(stdout).toEqual(`${installedPackage.version}\n`);
  });
});
