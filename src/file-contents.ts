import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { CliError } from "./CliError.js";

export const readFileIfPresent = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

export const readOptionFile = async (
  argumentLabel: string,
  path: string,
  workingDirectory: string,
): Promise<{ file: string; contents: string }> => {
  const file = resolve(workingDirectory, path);
  const contents = await readFileIfPresent(file);
  if (contents === undefined) {
    throw new CliError(`${argumentLabel} names ${file}, which does not exist.`);
  }
  return { file, contents };
};

const FILE_ARGUMENT_MARKER = "@";

export const atFileArgumentText = async (
  argumentLabel: string,
  argument: string,
  workingDirectory: string,
): Promise<string> => {
  if (!argument.startsWith(FILE_ARGUMENT_MARKER)) {
    return argument;
  }
  const path = argument.slice(FILE_ARGUMENT_MARKER.length);
  return (await readOptionFile(argumentLabel, path, workingDirectory)).contents;
};

export type JsonObject = { [field: string]: unknown };

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseJson = (contents: string): unknown => {
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
};

export const pathExists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

export const fileExists = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
