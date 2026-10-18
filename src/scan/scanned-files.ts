import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import picomatch from "picomatch";
import { CliError } from "../CliError.js";
import { pathExists, readFileIfPresent } from "../file-contents.js";
import { isSourceExtension, type SourceExtension } from "./source-languages.js";

export type ScannedFile = { path: string; displayPath: string; extension: SourceExtension; contents: string };

export type ScanRoot = { path: string; isDirectory: boolean; description: string };

export type ScanScope = {
  root: ScanRoot;
  workingDirectory: string;
  include: readonly string[] | "everyFile";
  exclude: readonly string[];
};

type GitignoreRules = { directory: string; rules: Ignore };

export const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "build",
  "dist",
  "target",
]);
const MAXIMUM_FILE_BYTES = 1024 * 1024;
const BYTES_CHECKED_FOR_BINARY_CONTENT = 8000;

const slashSeparated = (path: string) => path.split(sep).join("/");

const isInside = (directory: string, path: string) => {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory !== "" && !pathFromDirectory.startsWith("..") && !isAbsolute(pathFromDirectory);
};

export const scanRootAt = async (workingDirectory: string, path: string | undefined): Promise<ScanRoot> => {
  const rootPath = resolve(workingDirectory, path ?? ".");
  let rootStats: Stats;
  try {
    rootStats = await stat(rootPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(`There is no file or directory at ${path} to scan.`);
    }
    throw error;
  }
  return {
    path: rootPath,
    isDirectory: rootStats.isDirectory(),
    description: path ?? "the current directory",
  };
};

export const scanRootDirectory = (root: ScanRoot): string =>
  root.isDirectory ? root.path : dirname(root.path);

const gitignoreRulesIn = async (directory: string): Promise<GitignoreRules[]> => {
  const contents = await readFileIfPresent(join(directory, ".gitignore"));
  return contents === undefined ? [] : [{ directory, rules: ignore().add(contents) }];
};

const gitRepositoryRootAbove = async (path: string): Promise<string | undefined> => {
  for (let directory = path; ; directory = dirname(directory)) {
    if (await pathExists(join(directory, ".git"))) {
      return directory;
    }
    if (dirname(directory) === directory) {
      return undefined;
    }
  }
};

const ancestorDirectoriesBelow = (highestDirectory: string, path: string): string[] => {
  const ancestors: string[] = [];
  for (let directory = dirname(path); isInside(highestDirectory, directory); directory = dirname(directory)) {
    ancestors.unshift(directory);
  }
  return isInside(highestDirectory, path) ? [highestDirectory, ...ancestors] : [];
};

const isGitignored = (path: string, isDirectory: boolean, rulesInScope: readonly GitignoreRules[]) => {
  for (const { directory, rules } of [...rulesInScope].reverse()) {
    if (!isInside(directory, path)) {
      continue;
    }
    const pathFromDirectory = slashSeparated(relative(directory, path));
    const result = rules.test(isDirectory ? `${pathFromDirectory}/` : pathFromDirectory);
    if (result.ignored || result.unignored) {
      return result.ignored;
    }
  }
  return false;
};

export const readFileWithinSizeLimit = async (path: string): Promise<string | undefined> => {
  const stats = await stat(path).catch(() => undefined);
  return stats?.isFile() && stats.size <= MAXIMUM_FILE_BYTES ? readFile(path, "utf8") : undefined;
};

const hasBinaryContent = (contents: Buffer) =>
  contents.subarray(0, BYTES_CHECKED_FOR_BINARY_CONTENT).includes(0);

async function* candidateFiles(
  directory: string,
  rulesInScope: readonly GitignoreRules[],
): AsyncGenerator<string> {
  const rulesHere = [...rulesInScope, ...(await gitignoreRulesIn(directory))];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((first, second) => (first.name < second.name ? -1 : 1))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name) && !isGitignored(path, true, rulesHere)) {
        yield* candidateFiles(path, rulesHere);
      }
    } else if (entry.isFile() && !isGitignored(path, false, rulesHere)) {
      yield path;
    }
  }
}

export async function* scannedFiles(scope: ScanScope): AsyncGenerator<ScannedFile> {
  const isIncluded =
    scope.include === "everyFile" ? () => true : picomatch([...scope.include], { dot: true });
  const isExcluded = picomatch([...scope.exclude], { dot: true });
  const highestGitignoreDirectory = (await gitRepositoryRootAbove(scope.root.path)) ?? scope.workingDirectory;
  const ancestorRules = (
    await Promise.all(
      ancestorDirectoriesBelow(highestGitignoreDirectory, scope.root.path).map(gitignoreRulesIn),
    )
  ).flat();
  const candidates = scope.root.isDirectory
    ? candidateFiles(scope.root.path, ancestorRules)
    : (async function* () {
        if (!isGitignored(scope.root.path, false, ancestorRules)) {
          yield scope.root.path;
        }
      })();

  for await (const path of candidates) {
    const extension = extname(path);
    const displayPath = slashSeparated(relative(scope.workingDirectory, path));
    if (!isSourceExtension(extension) || !isIncluded(displayPath) || isExcluded(displayPath)) {
      continue;
    }
    if ((await stat(path)).size > MAXIMUM_FILE_BYTES) {
      continue;
    }
    const contents = await readFile(path);
    if (!hasBinaryContent(contents)) {
      yield { path, displayPath, extension, contents: contents.toString("utf8") };
    }
  }
}
