import { rm } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";
import { CliError } from "../CliError.js";
import { parseJson, readFileIfPresent } from "../file-contents.js";
import type { Invocation } from "../Invocation.js";
import { userConfigDirectory } from "../user-config-directory.js";

const ConfigJsonSchema = v.object({ token: v.string() });

export type ConfigJsonToken = { file: string; token: string };

const configJsonFile = (invocation: Invocation): string =>
  join(userConfigDirectory(invocation), "config.json");

export const readConfigJsonToken = async (invocation: Invocation): Promise<ConfigJsonToken | undefined> => {
  const file = configJsonFile(invocation);
  const contents = await readFileIfPresent(file);
  if (contents === undefined) {
    return undefined;
  }
  const configJson = v.safeParse(ConfigJsonSchema, parseJson(contents));
  if (!configJson.success) {
    throw new CliError(
      `${file} does not hold a saved API token. Delete it and run \`configdirector login\`.`,
    );
  }
  return { file, token: configJson.output.token };
};

export const deleteConfigJson = (configJsonToken: ConfigJsonToken): Promise<void> =>
  rm(configJsonToken.file, { force: true });
