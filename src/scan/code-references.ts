import { extname } from "node:path";
import { ConstantIndex, constantAssignmentsIn } from "./constant-index.js";
import { knownKeyTextsIn } from "./known-key-texts.js";
import { LocalImports } from "./local-imports.js";
import { ProjectAreas } from "./project-areas.js";
import { allSdkFamilies, sdkFamilies, type SdkFamily } from "./sdk-families.js";
import {
  dynamicReferenceOf,
  sdkCallMatches,
  type DirectReference,
  type DynamicReference,
  type FamilyCallShape,
  type SdkCallMatch,
} from "./sdk-calls.js";
import { readFileWithinSizeLimit, scannedFiles, type ScannedFile, type ScanScope } from "./scanned-files.js";
import { isSourceExtension, languageOfExtension } from "./source-languages.js";
import { SourceCode } from "./source-code.js";
import { isTestFile } from "./test-files.js";

type IndirectReference = { key: string; line: number; test: boolean };

export type CodeReference = { file: string } & (
  ({ kind: "direct" } & DirectReference) | ({ kind: "indirect" } & IndirectReference)
);

export type CodeReferenceScan = {
  filesScanned: number;
  references: CodeReference[];
  dynamicReferences: Array<DynamicReference & { file: string }>;
};

type KnownKeyTextMatch = {
  tokenIndex: number;
  kind: "indirect";
  reference: IndirectReference;
  constantName: string | undefined;
};

type FileMatch = SdkCallMatch | KnownKeyTextMatch;

type ImportedFile =
  { kind: "marked"; families: SdkFamily[] } | { kind: "unmarked"; reExportedFiles: string[] };

type ScanMatch = FileMatch & { file: string };

type MatchOutcome = { file: string } & (
  | { kind: "direct"; reference: DirectReference }
  | { kind: "indirect"; reference: IndirectReference }
  | { kind: "dynamic"; reference: DynamicReference }
  | { kind: "definitionOfConstantRead" }
);

const RE_EXPORT_STEPS_FOLLOWED = 2;

const byTokenIndex = (first: FileMatch, second: FileMatch) => first.tokenIndex - second.tokenIndex;

const matchesIn = (
  file: ScannedFile,
  code: SourceCode,
  callShapes: readonly FamilyCallShape[],
  projectKeys: ReadonlySet<string>,
  constantNameOfToken: ReadonlyMap<number, string>,
): FileMatch[] => {
  const callMatches = callShapes.length === 0 ? [] : sdkCallMatches(code, callShapes);
  const keyTokensOfCalls = new Set(
    callMatches.flatMap((match) => (match.kind === "direct" ? [match.tokenIndex] : [])),
  );
  const isTest = isTestFile(file.displayPath);
  const textMatches: FileMatch[] = knownKeyTextsIn(code, projectKeys, keyTokensOfCalls).map((text) => ({
    tokenIndex: text.tokenIndex,
    kind: "indirect",
    reference: { key: text.key, line: code.lineOf(text.tokenIndex), test: isTest },
    constantName: constantNameOfToken.get(text.tokenIndex),
  }));
  return [...callMatches, ...textMatches].sort(byTokenIndex);
};

const matchOutcomes = (matches: readonly ScanMatch[], constantIndex: ConstantIndex): MatchOutcome[] => {
  const constantsReadByCalls = new Set(
    matches.flatMap((match) =>
      match.kind === "named" && constantIndex.keyOf(match.name) !== undefined ? [match.name] : [],
    ),
  );
  return matches.map(({ file, ...match }): MatchOutcome => {
    switch (match.kind) {
      case "direct":
        return { file, kind: "direct", reference: match.reference };
      case "dynamic":
        return { file, kind: "dynamic", reference: match.reference };
      case "named": {
        const key = constantIndex.keyOf(match.name);
        return key === undefined
          ? { file, kind: "dynamic", reference: dynamicReferenceOf(match.reference) }
          : { file, kind: "direct", reference: { ...match.reference, key } };
      }
      case "indirect":
        return match.constantName !== undefined && constantsReadByCalls.has(match.constantName)
          ? { file, kind: "definitionOfConstantRead" }
          : { file, kind: "indirect", reference: match.reference };
    }
  });
};

const familiesWithMarkerIn = (contents: string, families: readonly SdkFamily[]): SdkFamily[] =>
  families.filter((family) => sdkFamilies[family].importMarkers.some((marker) => contents.includes(marker)));

const callsAnyOf = (code: SourceCode, families: readonly SdkFamily[]): boolean => {
  const callNames = new Set(
    families.flatMap((family) => sdkFamilies[family].calls.map((shape) => shape.name)),
  );
  return code.tokens.some((token) => token.kind === "identifier" && callNames.has(token.text));
};

const readImportedFile = async (path: string, localImports: LocalImports): Promise<ImportedFile> => {
  const contents = await readFileWithinSizeLimit(path);
  if (contents === undefined) {
    return { kind: "unmarked", reExportedFiles: [] };
  }
  const families = familiesWithMarkerIn(contents, allSdkFamilies);
  if (families.length > 0) {
    return { kind: "marked", families };
  }
  const extension = extname(path);
  return {
    kind: "unmarked",
    reExportedFiles: isSourceExtension(extension)
      ? await localImports.filesReExportedBy(new SourceCode(contents, languageOfExtension[extension]), path)
      : [],
  };
};

const sdkFamiliesUsedIn = (highestDirectory: string) => {
  const projectAreas = new ProjectAreas(highestDirectory);
  const localImports = new LocalImports(highestDirectory);
  const importedFileOfPath = new Map<string, Promise<ImportedFile>>();

  const importedFile = (path: string): Promise<ImportedFile> => {
    const importedFileReadBefore = importedFileOfPath.get(path);
    if (importedFileReadBefore !== undefined) {
      return importedFileReadBefore;
    }
    const importedFileRead = readImportedFile(path, localImports);
    importedFileOfPath.set(path, importedFileRead);
    return importedFileRead;
  };

  const familiesReachedThrough = async (path: string, reExportStepsLeft: number): Promise<SdkFamily[]> => {
    const reachedFile = await importedFile(path);
    switch (reachedFile.kind) {
      case "marked":
        return reachedFile.families;
      case "unmarked": {
        const reExportedFiles = reExportStepsLeft === 0 ? [] : reachedFile.reExportedFiles;
        const reachedFamilies = await Promise.all(
          reExportedFiles.map((reExportedFile) =>
            familiesReachedThrough(reExportedFile, reExportStepsLeft - 1),
          ),
        );
        return reachedFamilies.flat();
      }
    }
  };

  const familiesMarkedThroughImports = async (file: ScannedFile, code: SourceCode): Promise<SdkFamily[]> => {
    const importedPaths = await localImports.filesImportedBy(code, file.path);
    const reachedFamilies = await Promise.all(
      importedPaths.map((importedPath) => familiesReachedThrough(importedPath, RE_EXPORT_STEPS_FOLLOWED)),
    );
    return reachedFamilies.flat();
  };

  return async (file: ScannedFile, code: SourceCode): Promise<SdkFamily[]> => {
    const familiesForExtension = allSdkFamilies.filter((family) =>
      sdkFamilies[family].extensions.includes(file.extension),
    );
    const markedHere = familiesWithMarkerIn(file.contents, familiesForExtension);
    const unmarkedFamilies = familiesForExtension.filter((family) => !markedHere.includes(family));
    const markedThroughImports = callsAnyOf(code, unmarkedFamilies)
      ? await familiesMarkedThroughImports(file, code)
      : [];
    const usedFamilies: SdkFamily[] = [];
    for (const family of familiesForExtension) {
      const requiredArea = sdkFamilies[family].projectArea;
      const isMarked = markedHere.includes(family) || markedThroughImports.includes(family);
      if (isMarked && (requiredArea === undefined || (await projectAreas.contain(requiredArea, file.path)))) {
        usedFamilies.push(family);
      }
    }
    return usedFamilies;
  };
};

export const scanCodeReferences = async (
  scope: ScanScope,
  projectKeys: ReadonlySet<string>,
): Promise<CodeReferenceScan> => {
  const scan: CodeReferenceScan = { filesScanned: 0, references: [], dynamicReferences: [] };
  const familiesUsedIn = sdkFamiliesUsedIn(scope.workingDirectory);
  const constantIndex = new ConstantIndex();
  const matches: ScanMatch[] = [];
  for await (const file of scannedFiles(scope)) {
    scan.filesScanned += 1;
    const code = new SourceCode(file.contents, languageOfExtension[file.extension]);
    const callShapes: FamilyCallShape[] = (await familiesUsedIn(file, code)).flatMap((sdk) =>
      sdkFamilies[sdk].calls.map((shape) => ({ sdk, shape })),
    );
    const constantAssignments = constantAssignmentsIn(code);
    for (const assignment of constantAssignments) {
      constantIndex.add(assignment);
    }
    const constantNameOfToken = new Map(
      constantAssignments.map((assignment) => [assignment.tokenIndex, assignment.name]),
    );
    matches.push(
      ...matchesIn(file, code, callShapes, projectKeys, constantNameOfToken).map((match) => ({
        ...match,
        file: file.displayPath,
      })),
    );
  }
  for (const outcome of matchOutcomes(matches, constantIndex)) {
    switch (outcome.kind) {
      case "direct":
        scan.references.push({ ...outcome.reference, kind: "direct", file: outcome.file });
        break;
      case "indirect":
        scan.references.push({ ...outcome.reference, kind: "indirect", file: outcome.file });
        break;
      case "dynamic":
        scan.dynamicReferences.push({ ...outcome.reference, file: outcome.file });
        break;
      case "definitionOfConstantRead":
        break;
    }
  }
  return scan;
};
