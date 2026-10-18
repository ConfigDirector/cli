import { AdminApiClient, type Config, type Project } from "./admin-api/AdminApiClient.js";
import type { CommandContext } from "./CommandContext.js";
import { configuredApiToken } from "./configured-api-token.js";
import { findProjectBySlug, requireLinkedProjectSlug } from "./project-selection.js";
import { readProjectSettings } from "./project-settings.js";
import { scanCodeReferences, type CodeReferenceScan } from "./scan/code-references.js";
import type { ScanRoot } from "./scan/scanned-files.js";

type ProjectScan = {
  client: AdminApiClient;
  project: Project;
  configs: Config[];
  ignoredKeys: ReadonlySet<string>;
  codeReferenceScan: CodeReferenceScan;
};

export const scanProject = async (context: CommandContext, root: ScanRoot): Promise<ProjectScan> => {
  const { workingDirectory } = context.invocation;
  const settings = await readProjectSettings(workingDirectory);
  const projectSlug = requireLinkedProjectSlug(context, settings);
  const client = new AdminApiClient({ baseUrl: context.baseUrl, token: await configuredApiToken(context) });
  const project = await findProjectBySlug(client, projectSlug);
  const configs = (await client.listConfigs(project.id, { form: "every-config" })).map(
    (listedConfig) => listedConfig.config,
  );
  const projectKeys = new Set(
    configs.flatMap((config) => [
      config.key,
      ...config.deprecatedKeys.map((deprecatedKey) => deprecatedKey.key),
    ]),
  );
  const codeReferenceScan = await scanCodeReferences(
    {
      root,
      workingDirectory,
      include: settings?.include ?? "everyFile",
      exclude: settings?.exclude ?? [],
    },
    projectKeys,
  );
  return {
    client,
    project,
    configs,
    ignoredKeys: new Set(settings?.ignoreKeys ?? []),
    codeReferenceScan,
  };
};
