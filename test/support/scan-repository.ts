import { run } from "../../src/run.js";
import { writeRepositoryFile } from "./repository-files.js";
import { createSandbox } from "./sandbox.js";
import { startScanAdminApi, type ProjectConfig } from "./scan-admin-api.js";

export type RepositoryFiles = Record<string, string[]>;

export const serverSdkSetup = [
  'import { createClient } from "@configdirector/server-sdk";',
  "",
  'const client = createClient("YOUR-SERVER-SDK-KEY");',
];

type RepositoryCommand = "scan" | "validate";

const runOnRepository = async (
  command: RepositoryCommand,
  files: RepositoryFiles,
  configs: ProjectConfig[],
  outputOptions: string[],
) => {
  const adminApi = await startScanAdminApi({ configs });
  const sandbox = await createSandbox();
  for (const [path, lines] of Object.entries(files)) {
    await writeRepositoryFile(sandbox.workingDirectory, path, `${lines.join("\n")}\n`);
  }
  const invocation = sandbox.invocation({
    commandLineArguments: [command, "--project", "web-app", "--token", "cd_flag_token", ...outputOptions],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const runOnRepositoryJson = async (
  command: RepositoryCommand,
  files: RepositoryFiles,
  configs: ProjectConfig[],
) => {
  const { exitCode, stdout, stderr } = await runOnRepository(command, files, configs, ["--json"]);
  return { exitCode, stderr, output: JSON.parse(stdout) };
};

export const scanRepositoryText = (files: RepositoryFiles, configs: ProjectConfig[] = []) =>
  runOnRepository("scan", files, configs, []);

export const scanRepositoryJson = (files: RepositoryFiles, configs: ProjectConfig[] = []) =>
  runOnRepositoryJson("scan", files, configs);

export const validateRepositoryText = (files: RepositoryFiles, configs: ProjectConfig[] = []) =>
  runOnRepository("validate", files, configs, []);

export const validateRepositoryJson = (files: RepositoryFiles, configs: ProjectConfig[] = []) =>
  runOnRepositoryJson("validate", files, configs);
