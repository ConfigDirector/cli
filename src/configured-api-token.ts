import { CliError } from "./CliError.js";
import type { CommandContext } from "./CommandContext.js";
import { nonEmptyVariable } from "./Invocation.js";
import { readSavedApiToken } from "./saved-api-token.js";

export const configuredApiToken = async (context: CommandContext): Promise<string> => {
  const token =
    context.tokenOption ??
    nonEmptyVariable(context.invocation, "CONFIGDIRECTOR_TOKEN") ??
    (await readSavedApiToken(context.invocation));
  if (!token) {
    throw new CliError(
      "No API token found. Set CONFIGDIRECTOR_TOKEN, pass --token, or run `configdirector login`.",
    );
  }
  return token;
};
