import type { Environment } from "../admin-api/AdminApiClient.js";
import { alignedListing, type ListingOptions } from "../aligned-columns.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { connectToLinkedProject } from "../project-selection.js";

const ENVIRONMENT_HEADER_ROW = ["SLUG", "NAME", "LIVE"];

const environmentColumns = (environment: Environment): string[] =>
  environment.live ? [environment.slug, environment.name, "live"] : [environment.slug, environment.name];

const environmentLines = (
  projectSlug: string,
  environments: Environment[],
  options: ListingOptions,
): string[] =>
  environments.length === 0
    ? [`No environments found in ${projectSlug}.`]
    : alignedListing(ENVIRONMENT_HEADER_ROW, environments.map(environmentColumns), options);

export const listEnvironments = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: ListingOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: environments, responseBody } = await client.listEnvironments(project.id);

  return {
    json: responseBody,
    text: [...environmentLines(project.slug, environments, options), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
