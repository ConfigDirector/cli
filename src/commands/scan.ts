import type { ScannedRepository } from "../admin-api/repository-scan-upload.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { plural } from "../plural.js";
import { scanProject } from "../project-scan.js";
import type { CodeReference, CodeReferenceScan } from "../scan/code-references.js";
import { fitsKeyGrammar } from "../scan/literals.js";
import { scanRootAt, scanRootDirectory, type ScanRoot } from "../scan/scanned-files.js";
import { readGitCheckout } from "../scanned-repository/git-checkout.js";
import { repositoryIdentityOf } from "../scanned-repository/repository-identity.js";

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

const codeReferenceScanJson = (scan: CodeReferenceScan) => ({
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

export const scanJson = (projectSlug: string, scan: CodeReferenceScan) => ({
  project: projectSlug,
  ...codeReferenceScanJson(scan),
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

export const nothingToScanText = (scannedLocation: string) =>
  `No source files to scan in ${scannedLocation}.\n`;

const scanText = (scan: CodeReferenceScan, scannedLocation: string): string => {
  if (scan.filesScanned === 0) {
    return nothingToScanText(scannedLocation);
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

const SHORT_COMMIT_LENGTH = 7;

const shortCommitText = (commit: string): string =>
  commit === "" ? "" : ` at ${commit.slice(0, SHORT_COMMIT_LENGTH)}`;

const uploadLine = (projectSlug: string, repository: ScannedRepository, leftOutCount: number): string =>
  `Uploaded the scan of ${repository.name}${shortCommitText(repository.commit)} to ${projectSlug}: ` +
  `${repository.referenceCount} ${plural(repository.referenceCount, "reference", "references")} and ` +
  `${repository.dynamicReferenceCount} ${plural(repository.dynamicReferenceCount, "dynamic reference", "dynamic references")}, ` +
  `with ${leftOutCount} left out for a key that cannot be a config key.`;

const uploadScan = async (
  context: CommandContext,
  root: ScanRoot,
  repositoryOption: string | undefined,
): Promise<CommandOutput> => {
  const repository = repositoryIdentityOf(
    await readGitCheckout(scanRootDirectory(root), context.invocation.environmentVariables),
    repositoryOption,
    root.description,
  );
  const { client, project, codeReferenceScan } = await scanProject(context, root);
  if (codeReferenceScan.filesScanned === 0) {
    throw new CliError(
      `No source files to scan in ${root.description}, so nothing was uploaded ` +
        `and ${project.slug} keeps its code references for ${repository.name}. ` +
        "Check the path given to scan, and include and exclude in configdirector.json.",
    );
  }
  const configKeyReferences = codeReferenceScan.references.filter((reference) =>
    fitsKeyGrammar(reference.key),
  );
  const leftOutCount = codeReferenceScan.references.length - configKeyReferences.length;
  const { parsedBody: scannedRepository, responseBody } = await client.uploadRepositoryScan(
    project.id,
    repository.name,
    {
      remoteUrl: repository.remoteUrl,
      commit: repository.commit,
      ...codeReferenceScanJson({ ...codeReferenceScan, references: configKeyReferences }),
    },
  );

  return {
    json: responseBody,
    text: `${scanText(codeReferenceScan, root.description)}\n${uploadLine(project.slug, scannedRepository, leftOutCount)}\n`,
    exitCode: ExitCode.success,
  };
};

type ScanOptions = { upload?: true; repository?: string };

export const scan = async (
  context: CommandContext,
  [path]: ReadonlyArray<string | undefined>,
  options: ScanOptions,
): Promise<CommandOutput> => {
  const root = await scanRootAt(context.invocation.workingDirectory, path);
  if (options.upload) {
    return uploadScan(context, root, options.repository);
  }
  const { project, codeReferenceScan } = await scanProject(context, root);

  return {
    json: scanJson(project.slug, codeReferenceScan),
    text: scanText(codeReferenceScan, root.description),
    exitCode: ExitCode.success,
  };
};
