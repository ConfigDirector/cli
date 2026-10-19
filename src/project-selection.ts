import { AdminApiClient, type Project } from "./admin-api/AdminApiClient.js";
import { CliError } from "./CliError.js";
import type { CommandContext } from "./CommandContext.js";
import {
  configuredApiToken,
  describeApiTokenSource,
  type ConfiguredApiToken,
} from "./configured-api-token.js";
import { readProjectSettings, type ProjectSettings } from "./project-settings.js";

export const requireProjectSlug = (context: CommandContext): string => {
  if (context.projectSlug === undefined) {
    throw new CliError("Name the project with --project <slug> or CONFIGDIRECTOR_PROJECT.");
  }
  return context.projectSlug;
};

const requireLinkedProjectSlug = (context: CommandContext, settings: ProjectSettings | undefined): string => {
  const slug = context.projectSlug ?? settings?.project;
  if (slug === undefined) {
    throw new CliError(
      "Name the project with --project <slug>, CONFIGDIRECTOR_PROJECT, or `project` in configdirector.json, " +
        "which `configdirector init` writes.",
    );
  }
  return slug;
};

const findProjectBySlug = async (client: AdminApiClient, slug: string): Promise<Project> => {
  const { parsedBody: projects } = await client.listProjects();
  const project = projects.find((listedProject) => listedProject.slug === slug);
  if (project === undefined) {
    throw new CliError(`No project in the API token's organization has the slug "${slug}".`);
  }
  return project;
};

type ProjectOrganizationCheck =
  | { verdict: "not-checked" }
  | { verdict: "same" }
  | { verdict: "another-organization"; linkedOrganizationId: string };

const projectOrganizationCheck = (
  project: Project,
  settings: ProjectSettings | undefined,
): ProjectOrganizationCheck => {
  if (settings?.organization === undefined) {
    return { verdict: "not-checked" };
  }
  return project.organizationId === settings.organization
    ? { verdict: "same" }
    : { verdict: "another-organization", linkedOrganizationId: settings.organization };
};

const refuseProjectOfAnotherOrganization = (
  project: Project,
  settings: ProjectSettings | undefined,
  apiToken: ConfiguredApiToken,
): void => {
  const check = projectOrganizationCheck(project, settings);
  switch (check.verdict) {
    case "not-checked":
    case "same":
      return;
    case "another-organization":
      throw new CliError(
        `The token from ${describeApiTokenSource(apiToken.source)} belongs to the organization ` +
          `${project.organizationId}, whose project "${project.slug}" is not the one this directory links to: ` +
          `configdirector.json names the organization ${check.linkedOrganizationId}. ` +
          "Use a token of that organization, or run the command somewhere else.",
      );
  }
};

type LinkedProjectConnection = {
  client: AdminApiClient;
  project: Project;
  settings: ProjectSettings | undefined;
};

export const connectToLinkedProject = async (context: CommandContext): Promise<LinkedProjectConnection> => {
  const settings = await readProjectSettings(context.invocation.workingDirectory);
  const projectSlug = requireLinkedProjectSlug(context, settings);
  const apiToken = await configuredApiToken(context);
  const client = new AdminApiClient({ baseUrl: context.baseUrl, token: apiToken.token });
  const project = await findProjectBySlug(client, projectSlug);
  refuseProjectOfAnotherOrganization(project, settings, apiToken);
  return { client, project, settings };
};
