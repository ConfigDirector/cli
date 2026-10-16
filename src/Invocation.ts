import type { Readable } from "node:stream";

type TextOutput = { write: (text: string) => unknown };

export type Invocation = {
  commandLineArguments: string[];
  environmentVariables: Readonly<Record<string, string | undefined>>;
  workingDirectory: string;
  homeDirectory: string;
  platform: NodeJS.Platform;
  stdin: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
  stdout: TextOutput;
  stderr: TextOutput;
};

export const nonEmptyVariable = (invocation: Invocation, name: string): string | undefined =>
  invocation.environmentVariables[name] || undefined;
