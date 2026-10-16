import { AdminApiClient } from "../admin-api/AdminApiClient.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configuredApiToken } from "../configured-api-token.js";
import { findProjectBySlug, requireLinkedProjectSlug } from "../project-selection.js";
import { readProjectSettings } from "../project-settings.js";
import { scanCodeReferences, type CodeReference, type CodeReferenceScan } from "../scan/code-references.js";
import { scanRootAt } from "../scan/scanned-files.js";

const referenceJson = (reference: CodeReference) => {
  switch (reference.kind) {
    case "direct":
      return {
        key: reference.key,
        file: reference.file,
        line: reference.line,
        kind: reference.kind,
        sdk: reference.sdk,
        call: reference.call,
        ...(reference.argument === undefined ? {} : { argument: reference.argument }),
        ...(reference.inCodeDefault === undefined ? {} : { default: reference.inCodeDefault }),
        ...(reference.getterType === undefined ? {} : { getterType: reference.getterType }),
        test: reference.test,
      };
    case "indirect":
      return {
        key: reference.key,
        file: reference.file,
        line: reference.line,
        kind: reference.kind,
        test: reference.test,
      };
  }
};

const scanJson = (projectSlug: string, scan: CodeReferenceScan) => ({
  project: projectSlug,
  filesScanned: scan.filesScanned,
  references: scan.references.map(referenceJson),
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

const describeReference = (reference: CodeReference): string => {
  switch (reference.kind) {
    case "direct": {
      const call =
        reference.argument === undefined ? reference.call : `${reference.call}(${reference.argument})`;
      return `${call} (${reference.test ? `${reference.sdk}, test` : reference.sdk})`;
    }
    case "indirect":
      return reference.test ? "(indirect, test)" : "(indirect)";
  }
};

const plural = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm);

const scanText = (scan: CodeReferenceScan, scannedLocation: string): string => {
  if (scan.filesScanned === 0) {
    return `No source files to scan in ${scannedLocation}.\n`;
  }
  const referencesByKey = new Map<string, CodeReference[]>();
  for (const reference of scan.references) {
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
          (reference) => `  ${reference.file}:${reference.line} ${describeReference(reference)}`,
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
  const directCount = scan.references.filter((reference) => reference.kind === "direct").length;
  const indirectCount = scan.references.length - directCount;
  const counts =
    `${directCount} direct, ${indirectCount} indirect and ${scan.dynamicReferences.length} dynamic references ` +
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
  const projectKeys = new Set(
    (await client.listConfigKeys(project.id)).flatMap((config) => [
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
    json: scanJson(project.slug, codeReferenceScan),
    text: scanText(codeReferenceScan, root.description),
  };
};
