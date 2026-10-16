import { AdminApiClient } from "../admin-api/AdminApiClient.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configuredApiToken } from "../configured-api-token.js";
import { findProjectBySlug, requireLinkedProjectSlug } from "../project-selection.js";
import { readProjectSettings } from "../project-settings.js";
import { scanCodeReferences, type CodeReferenceScan } from "../scan/code-references.js";
import { scanRootAt } from "../scan/scanned-files.js";

const scanJson = (projectSlug: string, scan: CodeReferenceScan) => ({
  project: projectSlug,
  filesScanned: scan.filesScanned,
  references: scan.directReferences.map((reference) => ({
    key: reference.key,
    file: reference.file,
    line: reference.line,
    kind: "direct",
    sdk: reference.sdk,
    call: reference.call,
    ...(reference.inCodeDefault === undefined ? {} : { default: reference.inCodeDefault }),
    ...(reference.getterType === undefined ? {} : { getterType: reference.getterType }),
    test: reference.test,
  })),
  dynamicReferences: scan.dynamicReferences.map((reference) => ({
    file: reference.file,
    line: reference.line,
    sdk: reference.sdk,
    call: reference.call,
    argument: reference.argument,
  })),
});

const DYNAMIC_REFERENCES_HEADING = "Dynamic references (calls whose key is not a string literal)";

const withCollapsedWhitespace = (text: string): string => {
  let collapsed = "";
  let previousWasWhitespace = false;
  for (const character of text) {
    const isWhitespace = character.trim() === "";
    if (!isWhitespace) {
      collapsed += character;
    } else if (!previousWasWhitespace) {
      collapsed += " ";
    }
    previousWasWhitespace = isWhitespace;
  }
  return collapsed;
};

const describeSdk = (reference: { sdk: string; test: boolean }) =>
  reference.test ? `(${reference.sdk}, test)` : `(${reference.sdk})`;

const plural = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm);

const scanText = (scan: CodeReferenceScan, scannedLocation: string): string => {
  if (scan.filesScanned === 0) {
    return `No source files to scan in ${scannedLocation}.\n`;
  }
  const referencesByKey = new Map<string, CodeReferenceScan["directReferences"]>();
  for (const reference of scan.directReferences) {
    const referencesToKey = referencesByKey.get(reference.key);
    if (referencesToKey === undefined) {
      referencesByKey.set(reference.key, [reference]);
    } else {
      referencesToKey.push(reference);
    }
  }
  const keySections = [...referencesByKey.keys()]
    .sort()
    .map((key) =>
      [
        key,
        ...(referencesByKey.get(key) ?? []).map(
          (reference) => `  ${reference.file}:${reference.line} ${reference.call} ${describeSdk(reference)}`,
        ),
      ].join("\n"),
    );
  const dynamicSection =
    scan.dynamicReferences.length === 0
      ? []
      : [
          [
            DYNAMIC_REFERENCES_HEADING,
            ...scan.dynamicReferences.map(
              (reference) =>
                `  ${reference.file}:${reference.line} ${reference.call}(${withCollapsedWhitespace(reference.argument)}) (${reference.sdk})`,
            ),
          ].join("\n"),
        ];
  const counts =
    `${scan.directReferences.length} direct and ${scan.dynamicReferences.length} dynamic references ` +
    `in ${scan.filesScanned} scanned ${plural(scan.filesScanned, "file", "files")}.`;
  return `${[...keySections, ...dynamicSection, counts].join("\n\n")}\n`;
};

export const scan = async (
  context: CommandContext,
  [path]: ReadonlyArray<string | undefined>,
): Promise<CommandOutput> => {
  const { workingDirectory } = context.invocation;
  const settings = await readProjectSettings(workingDirectory);
  const projectSlug = requireLinkedProjectSlug(context, settings);
  const root = await scanRootAt(workingDirectory, path);
  const client = new AdminApiClient({ baseUrl: context.baseUrl, token: await configuredApiToken(context) });
  const project = await findProjectBySlug(client, projectSlug);
  const codeReferenceScan = await scanCodeReferences({
    root,
    workingDirectory,
    include: settings?.include ?? "everyFile",
    exclude: settings?.exclude ?? [],
  });

  return {
    json: scanJson(project.slug, codeReferenceScan),
    text: scanText(codeReferenceScan, root.description),
  };
};
