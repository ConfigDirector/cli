import { AdminApiClient } from "../admin-api/AdminApiClient.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { readPastedApiToken } from "../pasted-api-token.js";
import { saveSignIn } from "../sign-ins/sign-ins.js";

const PERMISSION_TO_FIND_PROJECTS = "projects:read";

export const login = async (context: CommandContext): Promise<CommandOutput> => {
  if (context.organizationOption !== undefined) {
    throw new CliError(
      "login saves the sign-in for the token's own organization, so it takes no --organization or CONFIGDIRECTOR_ORGANIZATION.",
    );
  }
  const token = context.tokenOption ?? (await readPastedApiToken(context.invocation));
  const { parsedBody: apiToken } = await new AdminApiClient({
    baseUrl: context.baseUrl,
    token,
  }).describeApiToken();
  if (!apiToken.permissions.includes(PERMISSION_TO_FIND_PROJECTS)) {
    throw new CliError(
      `The API token lacks the ${PERMISSION_TO_FIND_PROJECTS} permission, which the CLI needs to find a project. ` +
        "Create a token with it on the dashboard's API tokens page.",
    );
  }
  const file = await saveSignIn(context, { organization: apiToken.organization, token });

  return {
    json: { signInsFile: file, organization: apiToken.organization },
    text: `Signed in to ${apiToken.organization.name}. The CLI sign-in is saved in ${file}\n`,
    exitCode: ExitCode.success,
  };
};
