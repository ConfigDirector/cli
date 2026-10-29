import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, type Sandbox } from "../../support/sandbox.js";
import { runSpawnedCommand, type SpawnedCommandResult } from "../../support/spawned-command.js";
import {
  adminApiUnderTest,
  projectUnderTest,
  type AdminApiUnderTest,
  type ProjectUnderTest,
} from "./admin-api-under-test.js";

export const builtCli = fileURLToPath(new URL("../../../dist/configdirector.mjs", import.meta.url));

type RunOptions = { input?: string; environmentVariables?: Record<string, string> };

export type CliUnderTest = {
  adminApi: AdminApiUnderTest;
  project: ProjectUnderTest;
  sandbox: Sandbox;
  run: (commandLineArguments: string[], options?: RunOptions) => Promise<SpawnedCommandResult>;
};

const runBuiltCli = (
  cli: Omit<CliUnderTest, "run">,
  commandLineArguments: string[],
  options: RunOptions,
): Promise<SpawnedCommandResult> =>
  runSpawnedCommand(process.execPath, [builtCli, ...commandLineArguments], {
    cwd: cli.sandbox.workingDirectory,
    environmentVariables: {
      HOME: cli.sandbox.homeDirectory,
      XDG_CONFIG_HOME: join(cli.sandbox.homeDirectory, ".config"),
      CONFIGDIRECTOR_BASE_URL: cli.adminApi.baseUrl,
      CONFIGDIRECTOR_TOKEN: cli.adminApi.token,
      CONFIGDIRECTOR_PROJECT: cli.project.slug,
      ...options.environmentVariables,
    },
    input: options.input ?? "",
  });

export const startCliUnderTest = async (): Promise<CliUnderTest> => {
  const adminApi = adminApiUnderTest();
  if (adminApi === undefined) {
    throw new Error("The integration suite needs CONFIGDIRECTOR_BASE_URL and CONFIGDIRECTOR_TOKEN.");
  }
  const cli = { adminApi, project: await projectUnderTest(adminApi), sandbox: await createSandbox() };
  return {
    ...cli,
    run: (commandLineArguments, options = {}) => runBuiltCli(cli, commandLineArguments, options),
  };
};

const FIXTURE_PREFIX = "cli-integration-test-";

export const uniqueKey = (): string => `${FIXTURE_PREFIX}${randomBytes(6).toString("hex")}`;

export const uniqueRepositoryName = (): string => `ConfigDirector/${uniqueKey()}`;

export const jsonOf = (result: SpawnedCommandResult): unknown => {
  if (result.exitCode !== 0) {
    throw new Error(`The CLI exited ${result.exitCode}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
};
