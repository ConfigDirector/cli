import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const writeRepositoryFile = async (
  repositoryDirectory: string,
  relativePath: string,
  contents: string | Buffer,
): Promise<void> => {
  const file = join(repositoryDirectory, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents);
};

export const copyFixtureRepository = async (repositoryDirectory: string, fixtureName: string) => {
  const fixtureDirectory = fileURLToPath(new URL(`../fixtures/${fixtureName}`, import.meta.url));
  await cp(fixtureDirectory, repositoryDirectory, { recursive: true });
};
