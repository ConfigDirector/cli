import type { Environment } from "../admin-api/AdminApiClient.js";
import { alignedColumns } from "../aligned-columns.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { connectToLinkedProject } from "../project-selection.js";

const environmentColumns = (environment: Environment): string[] =>
  environment.live ? [environment.slug, environment.name, "live"] : [environment.slug, environment.name];

const environmentLines = (projectSlug: string, environments: Environment[]): string[] =>
  environments.length === 0
    ? [`No environments found in ${projectSlug}.`]
    : alignedColumns(environments.map(environmentColumns));

export const listEnvironments = async (context: CommandContext): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: environments, responseBody } = await client.listEnvironments(project.id);

  return {
    json: responseBody,
    text: [...environmentLines(project.slug, environments), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
