import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileExists, readFileIfPresent } from "../file-contents.js";
import { plainStringContent } from "./literals.js";
import { NearestDeclarations } from "./nearest-declarations.js";
import { PathAliases } from "./path-aliases.js";
import { readFileWithinSizeLimit } from "./scanned-files.js";
import { SourceCode } from "./source-code.js";

type PythonImport = { level: number; modulePath: string[]; names: string[] };

type DartPackage = { root: string; name: string };

type GoModule = { root: string; path: string };

type SwiftProject = { kind: "swiftPackage" | "xcodeProject"; root: string };

const JAVASCRIPT_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
];
const TYPESCRIPT_EXTENSIONS_FOR: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const PYTHON_PACKAGE_FILE = "__init__.py";
const DART_PACKAGE_SCHEME = "package:";
const DART_LIBRARY_SCHEME = "dart:";
const DART_IMPORT_DIRECTIVES = ["import", "export", "part"];
const DART_RE_EXPORT_DIRECTIVES = ["export"];
const SWIFT_PACKAGE_MANIFEST = "Package.swift";
const SWIFT_PACKAGE_TARGETS_DIRECTORIES = ["Sources", "Tests"];
const XCODE_PROJECT_EXTENSION = ".xcodeproj";

const stringAt = (code: SourceCode, index: number): string | undefined =>
  code.token(index)?.kind === "string" ? plainStringContent(code, { first: index, last: index }) : undefined;

const unquoted = (text: string) => {
  const trimmed = text.trim();
  const quote = trimmed.charAt(0);
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote) ? trimmed.slice(1, -1) : trimmed;
};

const directoriesUpFrom = (directory: string, highestDirectory: string): string[] => {
  const directories = [directory];
  let current = directory;
  while (current !== highestDirectory && dirname(current) !== current) {
    current = dirname(current);
    directories.push(current);
  }
  return directories;
};

const ancestorDirectory = (directory: string, levelsUp: number): string => {
  let ancestor = directory;
  for (let level = 0; level < levelsUp; level += 1) {
    ancestor = dirname(ancestor);
  }
  return ancestor;
};

const isRelativeSpecifier = (specifier: string) =>
  specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");

const javascriptSpecifiers = (code: SourceCode): string[] =>
  code.tokens.flatMap((_token, index) => {
    const isModuleSpecifier =
      code.isIdentifier(index - 1, "from") ||
      code.isIdentifier(index - 1, "import") ||
      (code.isPunctuation(index - 1, "(") &&
        (code.isIdentifier(index - 2, "import") || code.isIdentifier(index - 2, "require")));
    const specifier = isModuleSpecifier ? stringAt(code, index) : undefined;
    return specifier === undefined ? [] : [specifier];
  });

const indexAfterReExportedNames = (code: SourceCode, exportIndex: number): number | undefined => {
  const namesIndex = exportIndex + 1;
  if (code.isPunctuation(namesIndex, "{")) {
    const closer = code.closerOf(namesIndex);
    return closer === undefined ? undefined : closer + 1;
  }
  if (code.isPunctuation(namesIndex, "*")) {
    return code.isIdentifier(namesIndex + 1, "as") ? namesIndex + 3 : namesIndex + 1;
  }
  return undefined;
};

const javascriptReExportSpecifiers = (code: SourceCode): string[] =>
  code.tokens.flatMap((_token, index) => {
    const fromIndex = code.isIdentifier(index, "export") ? indexAfterReExportedNames(code, index) : undefined;
    const specifier =
      fromIndex !== undefined && code.isIdentifier(fromIndex, "from")
        ? stringAt(code, fromIndex + 1)
        : undefined;
    return specifier === undefined ? [] : [specifier];
  });

const javascriptCandidates = (path: string): string[] => {
  const extension = extname(path);
  const withoutExtension = path.slice(0, path.length - extension.length);
  return [
    ...(JAVASCRIPT_SOURCE_EXTENSIONS.includes(extension) ? [path] : []),
    ...(TYPESCRIPT_EXTENSIONS_FOR[extension] ?? []).map(
      (typescriptExtension) => withoutExtension + typescriptExtension,
    ),
    ...JAVASCRIPT_SOURCE_EXTENSIONS.map((sourceExtension) => path + sourceExtension),
    ...JAVASCRIPT_SOURCE_EXTENSIONS.map((sourceExtension) => join(path, `index${sourceExtension}`)),
  ];
};

const pythonImportedNames = (code: SourceCode, start: number): string[] => {
  const names: string[] = [];
  let isInsideParentheses = false;
  for (let index = start; index < code.tokens.length; index += 1) {
    if (index > start && code.startsLine(index) && !isInsideParentheses) {
      break;
    }
    if (code.isPunctuation(index, "(")) {
      isInsideParentheses = true;
    } else if (code.isPunctuation(index, ")")) {
      break;
    } else if (code.isIdentifier(index, "as")) {
      index += 1;
    } else {
      const token = code.token(index);
      if (token?.kind === "identifier") {
        names.push(token.text);
      }
    }
  }
  return names;
};

const pythonFromImport = (code: SourceCode, fromIndex: number): PythonImport | undefined => {
  let index = fromIndex + 1;
  let level = 0;
  while (code.isPunctuation(index, ".")) {
    level += 1;
    index += 1;
  }
  const modulePath: string[] = [];
  for (
    let token = code.token(index);
    token?.kind === "identifier" && token.text !== "import";
    token = code.token(index)
  ) {
    modulePath.push(token.text);
    index += code.isPunctuation(index + 1, ".") ? 2 : 1;
  }
  return code.isIdentifier(index, "import")
    ? { level, modulePath, names: pythonImportedNames(code, index + 1) }
    : undefined;
};

const pythonPlainImports = (code: SourceCode, importIndex: number): PythonImport[] => {
  const imports: PythonImport[] = [];
  let modulePath: string[] = [];
  const endModule = () => {
    if (modulePath.length > 0) {
      imports.push({ level: 0, modulePath, names: [] });
    }
    modulePath = [];
  };
  for (let index = importIndex + 1; index < code.tokens.length && !code.startsLine(index); index += 1) {
    if (code.isIdentifier(index, "as")) {
      endModule();
      index += 1;
    } else if (code.isPunctuation(index, ",")) {
      endModule();
    } else {
      const token = code.token(index);
      if (token?.kind === "identifier") {
        modulePath.push(token.text);
      }
    }
  }
  endModule();
  return imports;
};

const pythonImports = (code: SourceCode): PythonImport[] =>
  code.tokens.flatMap((_token, index) => {
    if (!code.startsLine(index)) {
      return [];
    }
    if (code.isIdentifier(index, "from")) {
      const fromImport = pythonFromImport(code, index);
      return fromImport === undefined ? [] : [fromImport];
    }
    return code.isIdentifier(index, "import") ? pythonPlainImports(code, index) : [];
  });

const isRelativePythonImport = (pythonImport: PythonImport) => pythonImport.level > 0;

const pythonModuleFiles = (base: string, modulePath: readonly string[]): string[] => {
  if (modulePath.length === 0) {
    return [];
  }
  const path = join(base, ...modulePath);
  return [`${path}.py`, join(path, PYTHON_PACKAGE_FILE)];
};

const dartPackageDeclaredIn = async (directory: string): Promise<DartPackage | undefined> => {
  const contents = await readFileIfPresent(join(directory, "pubspec.yaml"));
  const nameLine = contents?.split("\n").find((line) => line.startsWith("name:"));
  return nameLine === undefined
    ? undefined
    : { root: directory, name: unquoted(nameLine.slice("name:".length)) };
};

const goModuleDeclaredIn = async (directory: string): Promise<GoModule | undefined> => {
  const contents = await readFileIfPresent(join(directory, "go.mod"));
  const moduleLine = contents?.split("\n").find((line) => line.startsWith("module "));
  return moduleLine === undefined
    ? undefined
    : { root: directory, path: unquoted(moduleLine.slice("module ".length)) };
};

const dartSpecifiers = (code: SourceCode, directives: readonly string[]): string[] =>
  code.tokens.flatMap((_token, index) => {
    const isDirective = directives.some((directive) => code.isIdentifier(index - 1, directive));
    const specifier = isDirective ? stringAt(code, index) : undefined;
    return specifier === undefined || specifier.startsWith(DART_LIBRARY_SCHEME) ? [] : [specifier];
  });

const goImportPaths = (code: SourceCode): string[] =>
  code.tokens.flatMap((_token, index) => {
    if (!code.isIdentifier(index, "import")) {
      return [];
    }
    const groupCloser = code.isPunctuation(index + 1, "(") ? code.closerOf(index + 1) : undefined;
    const lastIndex = groupCloser ?? index + 1;
    const paths: string[] = [];
    for (let pathIndex = index + 1; pathIndex <= lastIndex; pathIndex += 1) {
      const path = stringAt(code, pathIndex);
      if (path !== undefined) {
        paths.push(path);
      }
    }
    return paths;
  });

const swiftProjectDeclaredIn = async (directory: string): Promise<SwiftProject | undefined> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.isFile() && entry.name === SWIFT_PACKAGE_MANIFEST)) {
    return { kind: "swiftPackage", root: directory };
  }
  return entries.some((entry) => entry.isDirectory() && extname(entry.name) === XCODE_PROJECT_EXTENSION)
    ? { kind: "xcodeProject", root: directory }
    : undefined;
};

const swiftPackageTargetOf = (packageRoot: string, directory: string): string => {
  const [targetsDirectory, targetName] = relative(packageRoot, directory).split(sep);
  if (targetsDirectory === undefined || !SWIFT_PACKAGE_TARGETS_DIRECTORIES.includes(targetsDirectory)) {
    return packageRoot;
  }
  return targetName === undefined
    ? join(packageRoot, targetsDirectory)
    : join(packageRoot, targetsDirectory, targetName);
};

const goPackageNameIn = (code: SourceCode): string | undefined => {
  const name = code.token(1);
  return code.isIdentifier(0, "package") && name?.kind === "identifier" ? name.text : undefined;
};

const goPackageNameOfFile = async (file: string): Promise<string | undefined> => {
  const contents = await readFileWithinSizeLimit(file);
  return contents === undefined ? undefined : goPackageNameIn(new SourceCode(contents, "go"));
};

export class LocalImports {
  private readonly dartPackages: NearestDeclarations<DartPackage>;
  private readonly goModules: NearestDeclarations<GoModule>;
  private readonly swiftProjects: NearestDeclarations<SwiftProject>;
  private readonly pathAliases: PathAliases;
  private readonly goFilesOfDirectory = new Map<string, Promise<string[]>>();
  private readonly fileExistence = new Map<string, Promise<boolean>>();

  constructor(private readonly highestDirectory: string) {
    this.dartPackages = new NearestDeclarations(highestDirectory, dartPackageDeclaredIn);
    this.goModules = new NearestDeclarations(highestDirectory, goModuleDeclaredIn);
    this.swiftProjects = new NearestDeclarations(highestDirectory, swiftProjectDeclaredIn);
    this.pathAliases = new PathAliases(highestDirectory);
  }

  public filesImportedBy(code: SourceCode, file: string): Promise<string[]> {
    switch (code.language) {
      case "javascript":
        return this.javascriptFilesAt(javascriptSpecifiers(code), file);
      case "python":
        return this.pythonFilesAt(pythonImports(code), file);
      case "dart":
        return this.dartFilesAt(dartSpecifiers(code, DART_IMPORT_DIRECTIVES), file);
      case "go":
        return this.goFilesImportedBy(code, file);
      case "swift":
      case "kotlin":
      case "java":
      case "csharp":
        return Promise.resolve([]);
    }
  }

  public filesOfSamePackageOrTarget(code: SourceCode, file: string): Promise<string[]> {
    switch (code.language) {
      case "go":
        return this.goFilesOfSamePackage(code, file);
      case "swift":
        return this.swiftFilesOfSameTarget(file);
      case "javascript":
      case "python":
      case "dart":
      case "kotlin":
      case "java":
      case "csharp":
        return Promise.resolve([]);
    }
  }

  public filesReExportedBy(code: SourceCode, file: string): Promise<string[]> {
    switch (code.language) {
      case "javascript":
        return this.javascriptFilesAt(javascriptReExportSpecifiers(code), file);
      case "python":
        return basename(file) === PYTHON_PACKAGE_FILE
          ? this.pythonFilesAt(pythonImports(code).filter(isRelativePythonImport), file)
          : Promise.resolve([]);
      case "dart":
        return this.dartFilesAt(dartSpecifiers(code, DART_RE_EXPORT_DIRECTIVES), file);
      case "go":
      case "swift":
      case "kotlin":
      case "java":
      case "csharp":
        return Promise.resolve([]);
    }
  }

  private fileExistsAt(path: string): Promise<boolean> {
    const existenceCheckedBefore = this.fileExistence.get(path);
    if (existenceCheckedBefore !== undefined) {
      return existenceCheckedBefore;
    }
    const existence = fileExists(path);
    this.fileExistence.set(path, existence);
    return existence;
  }

  private async firstExistingFile(candidates: readonly string[]): Promise<string | undefined> {
    for (const candidate of candidates) {
      if (await this.fileExistsAt(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private async existingFiles(candidates: readonly string[]): Promise<string[]> {
    const existing: string[] = [];
    for (const candidate of candidates) {
      if (await this.fileExistsAt(candidate)) {
        existing.push(candidate);
      }
    }
    return existing;
  }

  private async javascriptFilesAt(specifiers: readonly string[], file: string): Promise<string[]> {
    const files: string[] = [];
    for (const specifier of specifiers) {
      const modulePaths = isRelativeSpecifier(specifier)
        ? [join(dirname(file), specifier)]
        : await this.pathAliases.modulePathsFor(specifier, file);
      const importedFile = await this.firstExistingFile(modulePaths.flatMap(javascriptCandidates));
      if (importedFile !== undefined) {
        files.push(importedFile);
      }
    }
    return files;
  }

  private async pythonFilesAt(imports: readonly PythonImport[], file: string): Promise<string[]> {
    const files: string[] = [];
    for (const { level, modulePath, names } of imports) {
      const bases =
        level === 0
          ? directoriesUpFrom(dirname(file), this.highestDirectory)
          : [ancestorDirectory(dirname(file), level - 1)];
      for (const base of bases) {
        const moduleFiles = await this.existingFiles([
          ...pythonModuleFiles(base, modulePath),
          ...names.flatMap((name) => pythonModuleFiles(base, [...modulePath, name])),
        ]);
        if (moduleFiles.length > 0) {
          files.push(...moduleFiles);
          break;
        }
      }
    }
    return files;
  }

  private async dartFilesAt(specifiers: readonly string[], file: string): Promise<string[]> {
    const ownPackage = await this.dartPackages.declarationAbove(file);
    const candidates = specifiers.flatMap((specifier) => {
      if (!specifier.startsWith(DART_PACKAGE_SCHEME)) {
        return [join(dirname(file), specifier)];
      }
      const [packageName, ...pathInPackage] = specifier.slice(DART_PACKAGE_SCHEME.length).split("/");
      return ownPackage !== undefined && packageName === ownPackage.name
        ? [join(ownPackage.root, "lib", ...pathInPackage)]
        : [];
    });
    return this.existingFiles(candidates);
  }

  private async goFilesImportedBy(code: SourceCode, file: string): Promise<string[]> {
    const module = await this.goModules.declarationAbove(file);
    if (module === undefined) {
      return [];
    }
    const packageDirectories = goImportPaths(code)
      .filter((path) => path === module.path || path.startsWith(`${module.path}/`))
      .map((path) => join(module.root, path.slice(module.path.length)));
    return (await Promise.all(packageDirectories.map((directory) => this.goFilesIn(directory)))).flat();
  }

  private async goFilesOfSamePackage(code: SourceCode, file: string): Promise<string[]> {
    const packageName = goPackageNameIn(code);
    if (packageName === undefined) {
      return [];
    }
    const files = await this.goFilesIn(dirname(file));
    const packageNames = await Promise.all(files.map(goPackageNameOfFile));
    return files.filter((_file, index) => packageNames[index] === packageName);
  }

  private async swiftFilesOfSameTarget(file: string): Promise<string[]> {
    const target = await this.swiftTargetOfDirectory(dirname(file));
    return this.swiftFilesOfTargetIn(target, target);
  }

  private async swiftFilesOfTargetIn(target: string, directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((entry) => entry.isFile() && extname(entry.name) === ".swift")
      .map((entry) => join(directory, entry.name));
    const filesOfSubdirectories = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const subdirectory = join(directory, entry.name);
          return (await this.swiftTargetOfDirectory(subdirectory)) === target
            ? this.swiftFilesOfTargetIn(target, subdirectory)
            : [];
        }),
    );
    return [...files, ...filesOfSubdirectories.flat()];
  }

  private async swiftTargetOfDirectory(directory: string): Promise<string> {
    const project = await this.swiftProjects.declarationAtOrAbove(directory);
    if (project === undefined) {
      return directory;
    }
    switch (project.kind) {
      case "swiftPackage":
        return swiftPackageTargetOf(project.root, directory);
      case "xcodeProject":
        return project.root;
    }
  }

  private goFilesIn(directory: string): Promise<string[]> {
    const filesListedBefore = this.goFilesOfDirectory.get(directory);
    if (filesListedBefore !== undefined) {
      return filesListedBefore;
    }
    const files = readdir(directory, { withFileTypes: true }).then(
      (entries) =>
        entries
          .filter((entry) => entry.isFile() && extname(entry.name) === ".go")
          .map((entry) => join(directory, entry.name)),
      () => [],
    );
    this.goFilesOfDirectory.set(directory, files);
    return files;
  }
}
