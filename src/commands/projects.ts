import { AdminApiClient, type Project } from "../admin-api/AdminApiClient.js";
import { alignedListing, type ListingOptions } from "../aligned-columns.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configuredApiToken } from "../configured-api-token.js";
import { ExitCode } from "../ExitCode.js";

const PROJECT_HEADER_ROW = ["SLUG", "NAME"];

const projectLines = (projects: Project[], options: ListingOptions): string[] =>
  projects.length === 0
    ? ["No projects found."]
    : alignedListing(
        PROJECT_HEADER_ROW,
        projects.map((project) => [project.slug, project.name]),
        options,
      );

export const listProjects = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: ListingOptions,
): Promise<CommandOutput> => {
  const client = new AdminApiClient({
    baseUrl: context.baseUrl,
    token: (await configuredApiToken(context)).token,
  });
  const { parsedBody: projects, responseBody } = await client.listProjects();

  return {
    json: responseBody,
    text: [...projectLines(projects, options), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
