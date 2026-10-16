import { stat } from "node:fs/promises";
import { readFileIfPresent } from "../file-contents.js";
import { LocalImports } from "./local-imports.js";
import { ProjectAreas } from "./project-areas.js";
import { allSdkFamilies, sdkFamilies, type SdkFamily } from "./sdk-families.js";
import {
  sdkCallReferences,
  type DirectReference,
  type DynamicReference,
  type FamilyCallShape,
} from "./sdk-calls.js";
import { MAXIMUM_FILE_BYTES, scannedFiles, type ScannedFile, type ScanScope } from "./scanned-files.js";
import { languageOfExtension } from "./source-languages.js";
import { SourceCode } from "./source-code.js";

export type CodeReferenceScan = {
  filesScanned: number;
  directReferences: Array<DirectReference & { file: string }>;
  dynamicReferences: Array<DynamicReference & { file: string }>;
};

const familiesWithMarkerIn = (contents: string, families: readonly SdkFamily[]): SdkFamily[] =>
  families.filter((family) => sdkFamilies[family].importMarkers.some((marker) => contents.includes(marker)));

const callsAnyOf = (code: SourceCode, families: readonly SdkFamily[]): boolean => {
  const callNames = new Set(
    families.flatMap((family) => sdkFamilies[family].calls.map((shape) => shape.name)),
  );
  return code.tokens.some((token) => token.kind === "identifier" && callNames.has(token.text));
};

const familiesMarkedInImportedFile = async (file: string): Promise<SdkFamily[]> => {
  const contents = (await stat(file)).size > MAXIMUM_FILE_BYTES ? undefined : await readFileIfPresent(file);
  return contents === undefined ? [] : familiesWithMarkerIn(contents, allSdkFamilies);
};

const sdkFamiliesUsedIn = (highestDirectory: string) => {
  const projectAreas = new ProjectAreas(highestDirectory);
  const localImports = new LocalImports(highestDirectory);
  const familiesMarkedInFile = new Map<string, Promise<SdkFamily[]>>();

  const familiesMarkedIn = (importedFile: string): Promise<SdkFamily[]> => {
    const familiesFoundBefore = familiesMarkedInFile.get(importedFile);
    if (familiesFoundBefore !== undefined) {
      return familiesFoundBefore;
    }
    const families = familiesMarkedInImportedFile(importedFile);
    familiesMarkedInFile.set(importedFile, families);
    return families;
  };

  const familiesMarkedThroughImports = async (file: ScannedFile, code: SourceCode): Promise<SdkFamily[]> =>
    (await Promise.all((await localImports.filesImportedBy(code, file.path)).map(familiesMarkedIn))).flat();

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

export const scanCodeReferences = async (scope: ScanScope): Promise<CodeReferenceScan> => {
  const scan: CodeReferenceScan = { filesScanned: 0, directReferences: [], dynamicReferences: [] };
  const familiesUsedIn = sdkFamiliesUsedIn(scope.workingDirectory);
  for await (const file of scannedFiles(scope)) {
    scan.filesScanned += 1;
    const code = new SourceCode(file.contents, languageOfExtension[file.extension]);
    const callShapes: FamilyCallShape[] = (await familiesUsedIn(file, code)).flatMap((sdk) =>
      sdkFamilies[sdk].calls.map((shape) => ({ sdk, shape })),
    );
    if (callShapes.length === 0) {
      continue;
    }
    const references = sdkCallReferences(code, callShapes);
    scan.directReferences.push(
      ...references.direct.map((reference) => ({ ...reference, file: file.displayPath })),
    );
    scan.dynamicReferences.push(
      ...references.dynamic.map((reference) => ({ ...reference, file: file.displayPath })),
    );
  }
  return scan;
};
