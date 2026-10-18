import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { plural } from "../plural.js";
import { scanProject } from "../project-scan.js";
import type { CodeReferenceScan } from "../scan/code-references.js";
import type { InCodeDefaultValue } from "../scan/literals.js";
import { scanRootAt } from "../scan/scanned-files.js";
import type { SdkType } from "../scan/sdk-families.js";
import {
  checkCodeReferences,
  type CodeReferenceCheck,
  type Finding,
  type ServedValueType,
} from "../validate/findings.js";
import { nothingToScanText, scanJson } from "./scan.js";

type FindingKind = Finding["kind"];

type FindingOfKind<K extends FindingKind> = Extract<Finding, { kind: K }>;

type FindingPresentation<K extends FindingKind> = {
  heading: string;
  facts: (finding: FindingOfKind<K>) => object;
  description: (finding: FindingOfKind<K>, projectSlug: string) => string;
};

const SERVED_VALUE_TYPE_NAMES: { [T in ServedValueType]: string } = {
  boolean: "a boolean",
  string: "a string",
  integer: "an integer",
  float: "a float",
  json: "JSON",
  "string-enum": "strings",
  "number-enum": "numbers",
};

const CONFIG_TYPES_SERVED_AS_THEMSELVES: ReadonlySet<string> = new Set([
  "boolean",
  "string",
  "integer",
  "float",
  "json",
]);

const describeAvailability = (configAvailableTo: readonly SdkType[]): string => {
  const [onlySdkType] = configAvailableTo;
  return onlySdkType === undefined ? "served to no SDK" : `${onlySdkType}-only`;
};

const describeInCodeDefault = (inCodeDefault: InCodeDefaultValue): string =>
  inCodeDefault.type === "string" ? JSON.stringify(inCodeDefault.value) : String(inCodeDefault.value);

const describeConfigType = (configType: string, servedAs: ServedValueType): string =>
  CONFIG_TYPES_SERVED_AS_THEMSELVES.has(configType)
    ? configType
    : `${configType}, served as ${SERVED_VALUE_TYPE_NAMES[servedAs]}`;

const FINDING_PRESENTATIONS: { [K in FindingKind]: FindingPresentation<K> } = {
  "unknown-key": {
    heading: "Unknown keys",
    facts: () => ({}),
    description: (_finding, projectSlug) => `no config in ${projectSlug} has this key.`,
  },
  "deprecated-key": {
    heading: "Deprecated keys",
    facts: (finding) => ({ currentKey: finding.currentKey }),
    description: (finding) => `the config was renamed to ${finding.currentKey}.`,
  },
  "type-mismatch": {
    heading: "Type mismatches",
    facts: (finding) => ({
      configType: finding.configType,
      servedAs: finding.servedAs,
      ...(finding.reference.inCodeDefault === undefined ? {} : { default: finding.reference.inCodeDefault }),
      ...(finding.reference.getterType === undefined ? {} : { getterType: finding.reference.getterType }),
    }),
    description: (finding) =>
      `read as ${finding.typeRead}, but the config's type is ${describeConfigType(finding.configType, finding.servedAs)}.`,
  },
  "availability-mismatch": {
    heading: "Availability mismatches",
    facts: (finding) => ({
      sdk: finding.reference.sdk,
      sdkType: finding.sdkType,
      configAvailableTo: finding.configAvailableTo,
    }),
    description: (finding) =>
      `read from a ${finding.sdkType} SDK (${finding.reference.sdk}), ` +
      `but the config is ${describeAvailability(finding.configAvailableTo)}.`,
  },
  "enum-value-not-allowed": {
    heading: "Enum values not allowed",
    facts: (finding) => ({ default: finding.inCodeDefault, allowedValues: finding.allowedValues }),
    description: (finding) =>
      `${describeInCodeDefault(finding.inCodeDefault)} is not one of the allowed values: ` +
      `${finding.allowedValues.join(", ")}.`,
  },
};

const presentationOf = <K extends FindingKind>(finding: FindingOfKind<K>): FindingPresentation<K> =>
  FINDING_PRESENTATIONS[finding.kind];

const findingJson = (finding: Finding) => ({
  kind: finding.kind,
  key: finding.reference.key,
  file: finding.reference.file,
  line: finding.reference.line,
  ...presentationOf(finding).facts(finding),
});

const findingLine = (finding: Finding, projectSlug: string) =>
  `  ${finding.reference.file}:${finding.reference.line} ${finding.reference.key}: ` +
  presentationOf(finding).description(finding, projectSlug);

const countsText = (scan: CodeReferenceScan, check: CodeReferenceCheck): string => {
  const findingCount = check.findings.length;
  const problems =
    findingCount === 0 ? "no problems" : `${findingCount} ${plural(findingCount, "problem", "problems")}`;
  const checked =
    `Checked ${check.referencesChecked} direct ${plural(check.referencesChecked, "reference", "references")} ` +
    `in ${scan.filesScanned} scanned ${plural(scan.filesScanned, "file", "files")} and found ${problems}.`;
  const dynamicCount = scan.dynamicReferences.length;
  return dynamicCount === 0
    ? checked
    : `${checked} ${dynamicCount} dynamic ${plural(dynamicCount, "reference was", "references were")} not checked.`;
};

const validateText = (
  projectSlug: string,
  scan: CodeReferenceScan,
  scannedLocation: string,
  check: CodeReferenceCheck,
): string => {
  if (scan.filesScanned === 0) {
    return nothingToScanText(scannedLocation);
  }
  const kindSections = (Object.keys(FINDING_PRESENTATIONS) as FindingKind[]).flatMap((kind) => {
    const findingsOfKind = check.findings.filter((finding) => finding.kind === kind);
    return findingsOfKind.length === 0
      ? []
      : [
          [
            FINDING_PRESENTATIONS[kind].heading,
            ...findingsOfKind.map((finding) => findingLine(finding, projectSlug)),
          ].join("\n"),
        ];
  });
  return `${[...kindSections, countsText(scan, check)].join("\n\n")}\n`;
};

export const validate = async (
  context: CommandContext,
  [path]: ReadonlyArray<string | undefined>,
): Promise<CommandOutput> => {
  const root = await scanRootAt(context.invocation.workingDirectory, path);
  const { project, configs, ignoredKeys, codeReferenceScan } = await scanProject(context, root);
  const check = checkCodeReferences(codeReferenceScan.references, configs, ignoredKeys);

  return {
    json: { ...scanJson(project.slug, codeReferenceScan), findings: check.findings.map(findingJson) },
    text: validateText(project.slug, codeReferenceScan, root.description, check),
    exitCode: check.findings.length === 0 ? ExitCode.success : ExitCode.problemsFound,
  };
};
