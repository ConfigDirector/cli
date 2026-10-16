import { AdminApiClient } from "../admin-api/AdminApiClient.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { readPastedApiToken } from "../pasted-api-token.js";
import { saveApiToken } from "../saved-api-token.js";

export const login = async (context: CommandContext): Promise<CommandOutput> => {
  const token = context.tokenOption ?? (await readPastedApiToken(context.invocation));
  await new AdminApiClient({ baseUrl: context.baseUrl, token }).listProjects();
  const file = await saveApiToken(context.invocation, token);

  return {
    json: { tokenFile: file },
    text: `Logged in. The API token is saved in ${file}\n`,
    exitCode: ExitCode.success,
  };
};
