import { spawn } from "node:child_process";

export type SpawnedCommandResult = { exitCode: number | null; stdout: string; stderr: string };

type SpawnOptions = { cwd: string; environmentVariables: Record<string, string>; input: string };

export const runSpawnedCommand = (
  executable: string,
  commandLineArguments: string[],
  options: SpawnOptions,
): Promise<SpawnedCommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, commandLineArguments, {
      cwd: options.cwd,
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
