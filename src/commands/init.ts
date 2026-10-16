import { access, writeFile } from "node:fs/promises";
import { AdminApiClient } from "../admin-api/AdminApiClient.js";
import { configuredApiToken } from "../configured-api-token.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { findProjectBySlug, requireProjectSlug } from "../project-selection.js";
import { projectSettingsFile } from "../project-settings.js";

const refuseExistingFile = async (file: string): Promise<void> => {
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new CliError(`${file} already exists. init never overwrites it; edit the file instead.`);
  }
};

export const init = async (context: CommandContext): Promise<CommandOutput> => {
  const settingsFile = projectSettingsFile(context.invocation.workingDirectory);
  await refuseExistingFile(settingsFile);
  const projectSlug = requireProjectSlug(context);
  const client = new AdminApiClient({ baseUrl: context.baseUrl, token: await configuredApiToken(context) });
  const project = await findProjectBySlug(client, projectSlug);
  const settings = { project: project.slug, include: ["**"], exclude: [], ignoreKeys: [] };
  await writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx" });

  return {
    json: { settingsFile, project: { id: project.id, slug: project.slug, name: project.name } },
    text: `Linked this directory to the project ${project.name} (${project.slug}) in ${settingsFile}\n`,
  };
};
