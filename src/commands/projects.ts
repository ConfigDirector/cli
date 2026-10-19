import { AdminApiClient, type Project } from "../admin-api/AdminApiClient.js";
import { alignedColumns } from "../aligned-columns.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configuredApiToken } from "../configured-api-token.js";
import { ExitCode } from "../ExitCode.js";

const projectLines = (projects: Project[]): string[] =>
  projects.length === 0
    ? ["No projects found."]
    : alignedColumns(projects.map((project) => [project.slug, project.name]));

export const listProjects = async (context: CommandContext): Promise<CommandOutput> => {
  const client = new AdminApiClient({
    baseUrl: context.baseUrl,
    token: (await configuredApiToken(context)).token,
  });
  const { parsedBody: projects, responseBody } = await client.listProjects();

  return {
    json: responseBody,
    text: [...projectLines(projects), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
