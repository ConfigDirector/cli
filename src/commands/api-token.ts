import { AdminApiClient, type DescribedApiToken, type ProjectAccess } from "../admin-api/AdminApiClient.js";
import { apiTokenKindNames } from "../api-token-kind-names.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configuredApiToken, describeApiTokenSource, type ApiTokenSource } from "../configured-api-token.js";
import { ExitCode } from "../ExitCode.js";
import { utcMinute } from "../utc-minute.js";

const listedOrNone = (values: string[]): string => (values.length === 0 ? "none" : values.join(", "));

const describeProjectAccess = (projectAccess: ProjectAccess): string => {
  switch (projectAccess.kind) {
    case "all":
      return "all projects";
    case "selected":
      return `selected projects (${listedOrNone(projectAccess.projectIds)})`;
  }
};

const apiTokenLines = (apiToken: DescribedApiToken, source: ApiTokenSource): string[] => [
  `Organization: ${apiToken.organization.name} (${apiToken.organization.id})`,
  `Name: ${apiToken.name}`,
  `Kind: ${apiTokenKindNames[apiToken.kind].name}`,
  `Permissions: ${listedOrNone(apiToken.permissions)}`,
  `Project access: ${describeProjectAccess(apiToken.projectAccess)}`,
  `Expires: ${apiToken.expiresAt === null ? "never" : utcMinute(apiToken.expiresAt)}`,
  `Source: ${describeApiTokenSource(source)}`,
];

export const getApiToken = async (context: CommandContext): Promise<CommandOutput> => {
  const { token, source } = await configuredApiToken(context);
  const { parsedBody: apiToken, responseBody } = await new AdminApiClient(
    { baseUrl: context.baseUrl, token },
    context.invocation,
  ).describeApiToken();

  return {
    json: responseBody,
    text: [...apiTokenLines(apiToken, source), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
