import { writeFile } from "node:fs/promises";
import { AdminApiClient, type Project } from "../admin-api/AdminApiClient.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { apiTokensToSearch, type ConfiguredApiToken } from "../configured-api-token.js";
import { ExitCode } from "../ExitCode.js";
import { readFileIfPresent, type JsonObject } from "../file-contents.js";
import { requireProjectSlug } from "../project-selection.js";
import { projectSettingsFile, projectSettingsOf } from "../project-settings.js";
import { describeSignIns } from "../sign-ins/chosen-sign-in.js";

type SettingsFileToWrite = {
  projectSlug: string;
  fieldsOf: (organizationId: string) => JsonObject;
};

const existingFileWithoutOrganization = (
  context: CommandContext,
  file: string,
  contents: string,
): SettingsFileToWrite => {
  const settings = projectSettingsOf(file, contents);
  if (settings.organization !== undefined) {
    throw new CliError(`${file} already exists. init never overwrites it; edit the file instead.`);
  }
  const projectSlug = settings.project ?? requireProjectSlug(context);
  if (context.projectSlug !== undefined && context.projectSlug !== projectSlug) {
    throw new CliError(
      `${file} links the project ${projectSlug}, but --project or CONFIGDIRECTOR_PROJECT names ${context.projectSlug}. ` +
        "init only adds the organization to an existing file; edit the file to link another project.",
    );
  }
  const otherFields = Object.fromEntries(Object.entries(settings).filter(([name]) => name !== "project"));
  return {
    projectSlug,
    fieldsOf: (organizationId) => ({ project: projectSlug, organization: organizationId, ...otherFields }),
  };
};

const newSettingsFile = (context: CommandContext): SettingsFileToWrite => {
  const projectSlug = requireProjectSlug(context);
  return {
    projectSlug,
    fieldsOf: (organizationId) => ({
      project: projectSlug,
      organization: organizationId,
      include: ["**"],
      exclude: [],
      ignoreKeys: [],
    }),
  };
};

const settingsFileToWrite = async (context: CommandContext, file: string): Promise<SettingsFileToWrite> => {
  const contents = await readFileIfPresent(file);
  return contents === undefined
    ? newSettingsFile(context)
    : existingFileWithoutOrganization(context, file, contents);
};

type ProjectFound = { apiToken: ConfiguredApiToken; project: Project };

const projectFoundWith = async (
  context: CommandContext,
  apiToken: ConfiguredApiToken,
  slug: string,
): Promise<ProjectFound | undefined> => {
  const client = new AdminApiClient({ baseUrl: context.baseUrl, token: apiToken.token });
  const { parsedBody: projects } = await client.listProjects();
  const project = projects.find((listedProject) => listedProject.slug === slug);
  return project === undefined ? undefined : { apiToken, project };
};

const describeOrganizationOf = ({ apiToken, project }: ProjectFound): string =>
  apiToken.source.from === "sign-in" ? apiToken.source.signIn.organization.name : project.organizationId;

const signInsSearched = (apiTokens: ConfiguredApiToken[]) =>
  apiTokens.flatMap((apiToken) => (apiToken.source.from === "sign-in" ? [apiToken.source.signIn] : []));

const onlyProjectFound = (
  slug: string,
  apiTokens: ConfiguredApiToken[],
  projectsFound: ProjectFound[],
): ProjectFound => {
  const [firstProjectFound] = projectsFound;
  if (projectsFound.length > 1) {
    throw new CliError(
      `The organizations ${projectsFound.map(describeOrganizationOf).join(" and ")} both have a project with the slug ` +
        `"${slug}". Name one with --organization.`,
    );
  }
  if (firstProjectFound === undefined) {
    const signIns = signInsSearched(apiTokens);
    throw new CliError(
      signIns.length === 0
        ? `No project in the API token's organization has the slug "${slug}".`
        : `No project has the slug "${slug}" in the organizations signed in to: ${describeSignIns(signIns)}.`,
    );
  }
  return firstProjectFound;
};

const findProjectAcrossOrganizations = async (
  context: CommandContext,
  slug: string,
): Promise<ProjectFound> => {
  const apiTokens = await apiTokensToSearch(context);
  const projectsFound: ProjectFound[] = [];
  for (const apiToken of apiTokens) {
    const projectFound = await projectFoundWith(context, apiToken, slug);
    if (projectFound !== undefined) {
      projectsFound.push(projectFound);
    }
  }
  return onlyProjectFound(slug, apiTokens, projectsFound);
};

export const init = async (context: CommandContext): Promise<CommandOutput> => {
  const settingsFile = projectSettingsFile(context.invocation.workingDirectory);
  const fileToWrite = await settingsFileToWrite(context, settingsFile);
  const projectFound = await findProjectAcrossOrganizations(context, fileToWrite.projectSlug);
  const { project } = projectFound;
  await writeFile(settingsFile, `${JSON.stringify(fileToWrite.fieldsOf(project.organizationId), null, 2)}\n`);

  return {
    json: {
      settingsFile,
      project: { id: project.id, slug: project.slug, name: project.name },
      organizationId: project.organizationId,
    },
    text:
      `Linked this directory to the project ${project.name} (${project.slug}) of the organization ` +
      `${describeOrganizationOf(projectFound)} in ${settingsFile}\n`,
    exitCode: ExitCode.success,
  };
};
