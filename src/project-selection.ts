import type { AdminApiClient, Project } from "./admin-api/AdminApiClient.js";
import { CliError } from "./CliError.js";
import type { CommandContext } from "./CommandContext.js";

export const requireProjectSlug = (context: CommandContext): string => {
  if (context.projectSlug === undefined) {
    throw new CliError("Name the project with --project <slug> or CONFIGDIRECTOR_PROJECT.");
  }
  return context.projectSlug;
};

export const findProjectBySlug = async (client: AdminApiClient, slug: string): Promise<Project> => {
  const project = (await client.listProjects()).find((listedProject) => listedProject.slug === slug);
  if (project === undefined) {
    throw new CliError(`No project in the API token's organization has the slug "${slug}".`);
  }
  return project;
};
