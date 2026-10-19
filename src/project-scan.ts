import { AdminApiClient, type Config, type Project } from "./admin-api/AdminApiClient.js";
import type { CommandContext } from "./CommandContext.js";
import { connectToLinkedProject } from "./project-selection.js";
import { scanCodeReferences, type CodeReferenceScan } from "./scan/code-references.js";
import type { ScanRoot } from "./scan/scanned-files.js";
import type { SnippetCut } from "./scan/snippets.js";

type ScannableProject = {
  client: AdminApiClient;
  project: Project;
  configs: Config[];
  ignoredKeys: ReadonlySet<string>;
  codeReferencesIn: (root: ScanRoot, snippetCut: SnippetCut) => Promise<CodeReferenceScan>;
};

export const connectToScannableProject = async (context: CommandContext): Promise<ScannableProject> => {
  const { workingDirectory } = context.invocation;
  const { client, project, settings } = await connectToLinkedProject(context);
  const configs = (await client.listConfigs(project.id, { form: "every-config" })).map(
    (listedConfig) => listedConfig.config,
  );
  const projectKeys = new Set(
    configs.flatMap((config) => [
      config.key,
      ...config.deprecatedKeys.map((deprecatedKey) => deprecatedKey.key),
    ]),
  );
  return {
    client,
    project,
    configs,
    ignoredKeys: new Set(settings?.ignoreKeys ?? []),
    codeReferencesIn: (root, snippetCut) =>
      scanCodeReferences(
        {
          root,
          workingDirectory,
          include: settings?.include ?? "everyFile",
          exclude: settings?.exclude ?? [],
        },
        projectKeys,
        snippetCut,
      ),
  };
};
