import type { Invocation } from "./Invocation.js";

export type CommandContext = {
  invocation: Invocation;
  baseUrl: string;
  tokenOption: string | undefined;
  projectSlug: string | undefined;
};

export type CommandOutput = { json: unknown; text: string };
