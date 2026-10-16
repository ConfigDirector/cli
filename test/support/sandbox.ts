import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { onTestFinished } from "vitest";
import type { Invocation } from "../../src/Invocation.js";

type CapturedOutput = {
  write: (text: string) => boolean;
  text: () => string;
};

const captureOutput = (): CapturedOutput => {
  const chunks: string[] = [];
  return {
    write: (text) => {
      chunks.push(text);
      return true;
    },
    text: () => chunks.join(""),
  };
};

type TestInvocation = Invocation & { stdout: CapturedOutput; stderr: CapturedOutput };

type InvocationOptions = {
  commandLineArguments: string[];
  environmentVariables?: Record<string, string>;
  platform?: NodeJS.Platform;
  stdin?: Invocation["stdin"];
};

export const createSandbox = async () => {
  const root = await mkdtemp(join(tmpdir(), "configdirector-cli-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const workingDirectory = join(root, "repository");
  const homeDirectory = join(root, "home");
  await mkdir(workingDirectory);
  await mkdir(homeDirectory);

  const invocation = (options: InvocationOptions): TestInvocation => ({
    commandLineArguments: options.commandLineArguments,
    environmentVariables: options.environmentVariables ?? {},
    workingDirectory,
    homeDirectory,
    platform: options.platform ?? "linux",
    stdin: options.stdin ?? Readable.from([]),
    stdout: captureOutput(),
    stderr: captureOutput(),
  });

  return { root, workingDirectory, homeDirectory, invocation };
};

export type Sandbox = Awaited<ReturnType<typeof createSandbox>>;
