import { AdminApiClient, type Project } from "./admin-api/AdminApiClient.js";
import { CliError } from "./CliError.js";
import type { CommandContext } from "./CommandContext.js";
import { configuredApiToken } from "./configured-api-token.js";
import { readProjectSettings, type ProjectSettings } from "./project-settings.js";

export const requireProjectSlug = (context: CommandContext): string => {
  if (context.projectSlug === undefined) {
    throw new CliError("Name the project with --project <slug> or CONFIGDIRECTOR_PROJECT.");
  }
  return context.projectSlug;
};

export const requireLinkedProjectSlug = (
  context: CommandContext,
  settings: ProjectSettings | undefined,
): string => {
  const slug = context.projectSlug ?? settings?.project;
  if (slug === undefined) {
    throw new CliError(
      "Name the project with --project <slug>, CONFIGDIRECTOR_PROJECT, or `project` in configdirector.json, " +
        "which `configdirector init` writes.",
    );
  }
  return slug;
};

export const findProjectBySlug = async (client: AdminApiClient, slug: string): Promise<Project> => {
  const { parsedBody: projects } = await client.listProjects();
  const project = projects.find((listedProject) => listedProject.slug === slug);
  if (project === undefined) {
    throw new CliError(`No project in the API token's organization has the slug "${slug}".`);
  }
  return project;
};

type LinkedProjectConnection = { client: AdminApiClient; project: Project };

export const connectToLinkedProject = async (context: CommandContext): Promise<LinkedProjectConnection> => {
  const projectSlug = requireLinkedProjectSlug(
    context,
    await readProjectSettings(context.invocation.workingDirectory),
  );
  const client = new AdminApiClient({ baseUrl: context.baseUrl, token: await configuredApiToken(context) });
  return { client, project: await findProjectBySlug(client, projectSlug) };
};
