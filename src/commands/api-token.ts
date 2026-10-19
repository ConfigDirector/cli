import { AdminApiClient, type DescribedApiToken } from "../admin-api/AdminApiClient.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configuredApiToken, describeApiTokenSource, type ApiTokenSource } from "../configured-api-token.js";
import { ExitCode } from "../ExitCode.js";
import { utcMinute } from "../utc-minute.js";

const apiTokenLines = (apiToken: DescribedApiToken, source: ApiTokenSource): string[] => [
  `Organization: ${apiToken.organization.name} (${apiToken.organization.id})`,
  `Name: ${apiToken.name}`,
  `Permissions: ${apiToken.permissions.length === 0 ? "none" : apiToken.permissions.join(", ")}`,
  `Expires: ${apiToken.expiresAt === null ? "never" : utcMinute(apiToken.expiresAt)}`,
  `Source: ${describeApiTokenSource(source)}`,
];

export const getApiToken = async (context: CommandContext): Promise<CommandOutput> => {
  const { token, source } = await configuredApiToken(context);
  const { parsedBody: apiToken, responseBody } = await new AdminApiClient({
    baseUrl: context.baseUrl,
    token,
  }).describeApiToken();

  return {
    json: responseBody,
    text: [...apiTokenLines(apiToken, source), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
