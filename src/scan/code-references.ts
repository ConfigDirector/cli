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
import { snippetCutterFor, type Snippet, type SnippetCut } from "./snippets.js";
import { isSourceExtension, languageOfExtension, type SourceExtension } from "./source-languages.js";
import { SourceCode } from "./source-code.js";
import { isTestFile } from "./test-files.js";

type IndirectReference = { key: string; line: number; test: boolean };

export type CodeReference = { file: string; snippet: Snippet | undefined } & (
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

type ReachedFile =
  { kind: "marked"; families: SdkFamily[] } | { kind: "unmarked"; reExportedFiles: string[] };

type ScanMatch = FileMatch & { file: string; snippet: Snippet | undefined };

type MatchOutcome = { file: string } & (
  | { kind: "direct"; reference: DirectReference; snippet: Snippet | undefined }
  | { kind: "indirect"; reference: IndirectReference; snippet: Snippet | undefined }
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
  return matches.map(({ file, snippet, ...match }): MatchOutcome => {
    switch (match.kind) {
      case "direct":
        return { file, kind: "direct", reference: match.reference, snippet };
      case "dynamic":
        return { file, kind: "dynamic", reference: match.reference };
      case "named": {
        const key = constantIndex.keyOf(match.name);
        return key === undefined
          ? { file, kind: "dynamic", reference: dynamicReferenceOf(match.reference) }
          : { file, kind: "direct", reference: { ...match.reference, key }, snippet };
      }
      case "indirect":
        return match.constantName !== undefined && constantsReadByCalls.has(match.constantName)
          ? { file, kind: "definitionOfConstantRead" }
          : { file, kind: "indirect", reference: match.reference, snippet };
    }
  });
};

const holdsImportMarkerOf = (contents: string, family: SdkFamily): boolean => {
  const { importMarkers, providerPackagesContainingMarkers = [] } = sdkFamilies[family];
  const contentsWithoutProviderPackages = providerPackagesContainingMarkers.reduce(
    (text, providerPackage) => text.replaceAll(providerPackage, ""),
    contents,
  );
  return importMarkers.some((marker) => contentsWithoutProviderPackages.includes(marker));
};

const familiesWithMarkerIn = (contents: string, families: readonly SdkFamily[]): SdkFamily[] =>
  families.filter((family) => holdsImportMarkerOf(contents, family));

const callsAnyOf = (code: SourceCode, families: readonly SdkFamily[]): boolean => {
  const callNames = new Set(
    families.flatMap((family) => sdkFamilies[family].calls.map((shape) => shape.name)),
  );
  return code.tokens.some((token) => token.kind === "identifier" && callNames.has(token.text));
};

const familiesOfExtension = (extension: SourceExtension): SdkFamily[] =>
  allSdkFamilies.filter((family) => sdkFamilies[family].extensions.includes(extension));

const readReachedFile = async (path: string, localImports: LocalImports): Promise<ReachedFile> => {
  const extension = extname(path);
  const contents = await readFileWithinSizeLimit(path);
  if (contents === undefined || !isSourceExtension(extension)) {
    return { kind: "unmarked", reExportedFiles: [] };
  }
  const families = familiesWithMarkerIn(contents, familiesOfExtension(extension));
  if (families.length > 0) {
    return { kind: "marked", families };
  }
  return {
    kind: "unmarked",
    reExportedFiles: await localImports.filesReExportedBy(
      new SourceCode(contents, languageOfExtension[extension]),
      path,
    ),
  };
};

const sdkFamiliesUsedIn = (highestDirectory: string) => {
  const projectAreas = new ProjectAreas(highestDirectory);
  const localImports = new LocalImports(highestDirectory);
  const reachedFileOfPath = new Map<string, Promise<ReachedFile>>();
  const familiesMarkedInPackageOrTargetOfFile = new Map<string, Promise<SdkFamily[]>>();

  const reachedFileAt = (path: string): Promise<ReachedFile> => {
    const reachedFileReadBefore = reachedFileOfPath.get(path);
    if (reachedFileReadBefore !== undefined) {
      return reachedFileReadBefore;
    }
    const reachedFileRead = readReachedFile(path, localImports);
    reachedFileOfPath.set(path, reachedFileRead);
    return reachedFileRead;
  };

  const familiesReachedThrough = async (path: string, reExportStepsLeft: number): Promise<SdkFamily[]> => {
    const reachedFile = await reachedFileAt(path);
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

  const familiesReachedThroughEach = async (paths: readonly string[]): Promise<SdkFamily[]> => {
    const reachedFamilies = await Promise.all(
      paths.map((path) => familiesReachedThrough(path, RE_EXPORT_STEPS_FOLLOWED)),
    );
    return reachedFamilies.flat();
  };

  const familiesMarkedThroughImports = async (file: ScannedFile, code: SourceCode): Promise<SdkFamily[]> =>
    familiesReachedThroughEach(await localImports.filesImportedBy(code, file.path));

  const familiesMarkedInHolderClasses = async (file: ScannedFile, code: SourceCode): Promise<SdkFamily[]> =>
    familiesReachedThroughEach(await localImports.holderClassFilesReferencedBy(code, file.path));

  const familiesMarkedInSamePackageOrTarget = async (
    file: ScannedFile,
    code: SourceCode,
  ): Promise<SdkFamily[]> => {
    const familiesFoundBefore = familiesMarkedInPackageOrTargetOfFile.get(file.path);
    if (familiesFoundBefore !== undefined) {
      return familiesFoundBefore;
    }
    const filesOfPackageOrTarget = await localImports.filesOfSamePackageOrTarget(code, file.path);
    const families = familiesReachedThroughEach(filesOfPackageOrTarget);
    for (const fileOfPackageOrTarget of filesOfPackageOrTarget) {
      familiesMarkedInPackageOrTargetOfFile.set(fileOfPackageOrTarget, families);
    }
    return families;
  };

  const familiesMarkedByOtherFiles = async (file: ScannedFile, code: SourceCode): Promise<SdkFamily[]> => [
    ...(await familiesMarkedThroughImports(file, code)),
    ...(await familiesMarkedInSamePackageOrTarget(file, code)),
    ...(await familiesMarkedInHolderClasses(file, code)),
  ];

  return async (file: ScannedFile, code: SourceCode): Promise<SdkFamily[]> => {
    const familiesForExtension = familiesOfExtension(file.extension);
    const markedHere = familiesWithMarkerIn(file.contents, familiesForExtension);
    const unmarkedFamilies = familiesForExtension.filter((family) => !markedHere.includes(family));
    const markedByOtherFiles = callsAnyOf(code, unmarkedFamilies)
      ? await familiesMarkedByOtherFiles(file, code)
      : [];
    const usedFamilies: SdkFamily[] = [];
    for (const family of familiesForExtension) {
      const requiredArea = sdkFamilies[family].projectArea;
      const isMarked = markedHere.includes(family) || markedByOtherFiles.includes(family);
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
  snippetCut: SnippetCut,
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
    const snippetAround = snippetCutterFor(file, snippetCut);
    matches.push(
      ...matchesIn(file, code, callShapes, projectKeys, constantNameOfToken).map((match) => ({
        ...match,
        file: file.displayPath,
        snippet: snippetAround(match.reference.line),
      })),
    );
  }
  for (const outcome of matchOutcomes(matches, constantIndex)) {
    switch (outcome.kind) {
      case "direct":
        scan.references.push({
          ...outcome.reference,
          kind: "direct",
          file: outcome.file,
          snippet: outcome.snippet,
        });
        break;
      case "indirect":
        scan.references.push({
          ...outcome.reference,
          kind: "indirect",
          file: outcome.file,
          snippet: outcome.snippet,
        });
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
