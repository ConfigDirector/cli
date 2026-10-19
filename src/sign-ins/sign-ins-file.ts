import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { CliError } from "../CliError.js";
import { parseJson, readFileIfPresent } from "../file-contents.js";
import type { Invocation } from "../Invocation.js";
import { userConfigDirectory } from "../user-config-directory.js";

const OrganizationSchema = v.object({ id: v.string(), name: v.string() });

export type Organization = v.InferOutput<typeof OrganizationSchema>;

const SignInSchema = v.object({ organization: OrganizationSchema, token: v.string() });

export type SignIn = v.InferOutput<typeof SignInSchema>;

const SignInsFileSchema = v.object({ signIns: v.array(SignInSchema) });

const signInsFile = (invocation: Invocation): string =>
  join(userConfigDirectory(invocation), "sign-ins.json");

export const readSignInsFile = async (invocation: Invocation): Promise<SignIn[]> => {
  const file = signInsFile(invocation);
  const contents = await readFileIfPresent(file);
  if (contents === undefined) {
    return [];
  }
  const parsedFile = v.safeParse(SignInsFileSchema, parseJson(contents));
  if (!parsedFile.success) {
    throw new CliError(
      `${file} does not hold CLI sign-ins. Delete it and run \`configdirector login\` again.`,
    );
  }
  return parsedFile.output.signIns;
};

export const writeSignInsFile = async (invocation: Invocation, signIns: SignIn[]): Promise<string> => {
  const file = signInsFile(invocation);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, "w", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify({ signIns }, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  return file;
};
