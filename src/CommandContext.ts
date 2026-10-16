import type { ExitCode } from "./ExitCode.js";
import type { Invocation } from "./Invocation.js";

export type CommandContext = {
  invocation: Invocation;
  baseUrl: string;
  tokenOption: string | undefined;
  projectSlug: string | undefined;
};

export type CommandOutput = {
  json: unknown;
  text: string;
  exitCode: typeof ExitCode.success | typeof ExitCode.problemsFound;
};
