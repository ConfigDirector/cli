import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { startScanAdminApi } from "./support/scan-admin-api.js";

const TIME_LIMIT_MILLISECONDS = 2000;

const serverSdkFile = (lines: string[]) =>
  [
    'import { createClient } from "@configdirector/server-sdk";',
    "",
    'const client = createClient("YOUR-SERVER-SDK-KEY");',
    ...lines,
    "",
  ].join("\n");

const timedScan = async (sandbox: Sandbox) => {
  const adminApi = await startScanAdminApi();
  const invocation = sandbox.invocation({
    commandLineArguments: ["scan", "--project", "web-app", "--token", "cd_flag_token", "--json"],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
  });

  const start = performance.now();
  const exitCode = await run(invocation);
  const elapsedMilliseconds = performance.now() - start;

  return { exitCode, elapsedMilliseconds, output: JSON.parse(invocation.stdout.text()) };
};

describe("scan on pathological input", () => {
  it("reads an in-code default value of 500,000 digits that ends in a letter in a fixed time", async () => {
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      serverSdkFile([`client.getValue("new-checkout", ${"1".repeat(500_000)}x);`]),
    );

    const { exitCode, elapsedMilliseconds, output } = await timedScan(sandbox);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual(undefined);
    expect(elapsedMilliseconds).toBeLessThan(TIME_LIMIT_MILLISECONDS);
  });

  it("reads an in-code default value with 250,000 digit separators in a fixed time", async () => {
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      serverSdkFile([`client.getValue("max-requests", 0${"_0".repeat(250_000)}L);`]),
    );

    const { exitCode, elapsedMilliseconds, output } = await timedScan(sandbox);

    expect(exitCode).toEqual(0);
    expect(output.references[0].default).toEqual({ type: "integer", value: 0 });
    expect(elapsedMilliseconds).toBeLessThan(TIME_LIMIT_MILLISECONDS);
  });

  it("scans 50,000 nested SDK calls that are never closed in a fixed time", async () => {
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "src/checkout.ts",
      serverSdkFile([`${"client.getValue(".repeat(50_000)}"new-checkout"`, `${"]".repeat(50_000)}`]),
    );

    const { exitCode, elapsedMilliseconds } = await timedScan(sandbox);

    expect(exitCode).toEqual(0);
    expect(elapsedMilliseconds).toBeLessThan(TIME_LIMIT_MILLISECONDS);
  });

  it("applies exclude globs and .gitignore patterns made of repeated globstars to a deep path in a fixed time", async () => {
    const sandbox = await createSandbox();
    const repeatedGlobstars = `${"**/".repeat(30)}generated.ts`;
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "configdirector.json",
      JSON.stringify({ project: "web-app", exclude: [repeatedGlobstars] }),
    );
    await writeRepositoryFile(sandbox.workingDirectory, ".gitignore", `${repeatedGlobstars}\n`);
    await writeRepositoryFile(
      sandbox.workingDirectory,
      `${"a/".repeat(60)}checkout.ts`,
      serverSdkFile(['client.getValue("new-checkout", false);']),
    );

    const { exitCode, elapsedMilliseconds, output } = await timedScan(sandbox);

    expect(exitCode).toEqual(0);
    expect(output.references.length).toEqual(1);
    expect(elapsedMilliseconds).toBeLessThan(TIME_LIMIT_MILLISECONDS);
  });
});
