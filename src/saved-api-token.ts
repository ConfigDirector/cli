import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { CliError } from "./CliError.js";
import { parseJson, readFileIfPresent } from "./file-contents.js";
import { nonEmptyVariable, type Invocation } from "./Invocation.js";

const SavedApiTokenSchema = v.object({ token: v.string() });

const platformConfigDirectory = (invocation: Invocation): string => {
  switch (invocation.platform) {
    case "darwin":
      return join(invocation.homeDirectory, "Library", "Application Support");
    case "win32":
      return nonEmptyVariable(invocation, "APPDATA") ?? join(invocation.homeDirectory, "AppData", "Roaming");
    default:
      return join(invocation.homeDirectory, ".config");
  }
};

const userConfigDirectory = (invocation: Invocation): string =>
  nonEmptyVariable(invocation, "XDG_CONFIG_HOME") ?? platformConfigDirectory(invocation);

const savedApiTokenFile = (invocation: Invocation): string =>
  join(userConfigDirectory(invocation), "configdirector", "config.json");

export const readSavedApiToken = async (invocation: Invocation): Promise<string | undefined> => {
  const file = savedApiTokenFile(invocation);
  const contents = await readFileIfPresent(file);
  if (contents === undefined) {
    return undefined;
  }
  const savedToken = v.safeParse(SavedApiTokenSchema, parseJson(contents));
  if (!savedToken.success) {
    throw new CliError(`${file} does not hold a saved API token. Run \`configdirector login\` again.`);
  }
  return savedToken.output.token;
};

export const saveApiToken = async (invocation: Invocation, token: string): Promise<string> => {
  const file = savedApiTokenFile(invocation);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, "w", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify({ token }, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  return file;
};
