import { AdminApiClient } from "../admin-api/AdminApiClient.js";
import { ApiAuthorizationError } from "../admin-api/admin-api-errors.js";
import type { CommandContext } from "../CommandContext.js";
import { deleteConfigJson, readConfigJsonToken, type ConfigJsonToken } from "./config-json-token.js";
import { readSignInsFile, writeSignInsFile, type Organization, type SignIn } from "./sign-ins-file.js";

const isFor = (signIn: SignIn, organization: Organization): boolean =>
  signIn.organization.id === organization.id;

const withSignIn = (signIns: SignIn[], signIn: SignIn): SignIn[] =>
  signIns.some((savedSignIn) => isFor(savedSignIn, signIn.organization))
    ? signIns.map((savedSignIn) => (isFor(savedSignIn, signIn.organization) ? signIn : savedSignIn))
    : [...signIns, signIn];

const withoutSignIn = (signIns: SignIn[], organization: Organization): SignIn[] =>
  signIns.filter((savedSignIn) => !isFor(savedSignIn, organization));

type ConfigJsonTokenMove = { outcome: "moved"; signIn: SignIn } | { outcome: "rejected"; code: string };

const configJsonTokenMoveOf = async (
  context: CommandContext,
  configJsonToken: ConfigJsonToken,
): Promise<ConfigJsonTokenMove> => {
  const client = new AdminApiClient({ baseUrl: context.baseUrl, token: configJsonToken.token });
  try {
    const { parsedBody: apiToken } = await client.describeApiToken();
    return {
      outcome: "moved",
      signIn: { organization: apiToken.organization, token: configJsonToken.token },
    };
  } catch (error) {
    if (error instanceof ApiAuthorizationError) {
      return { outcome: "rejected", code: error.code };
    }
    throw error;
  }
};

const withConfigJsonTokenMoved = async (context: CommandContext, signIns: SignIn[]): Promise<SignIn[]> => {
  const configJsonToken = await readConfigJsonToken(context.invocation);
  if (configJsonToken === undefined) {
    return signIns;
  }
  const move = await configJsonTokenMoveOf(context, configJsonToken);
  switch (move.outcome) {
    case "moved": {
      const movedSignIns = withSignIn(signIns, move.signIn);
      await writeSignInsFile(context.invocation, movedSignIns);
      await deleteConfigJson(configJsonToken);
      return movedSignIns;
    }
    case "rejected":
      await deleteConfigJson(configJsonToken);
      context.invocation.stderr.write(
        `The API token saved by an earlier version in ${configJsonToken.file} was rejected (${move.code}), ` +
          "so the file was deleted. Run `configdirector login` to sign in again.\n",
      );
      return signIns;
  }
};

export const savedSignIns = async (context: CommandContext): Promise<SignIn[]> =>
  withConfigJsonTokenMoved(context, await readSignInsFile(context.invocation));

export const saveSignIn = async (context: CommandContext, signIn: SignIn): Promise<string> =>
  writeSignInsFile(context.invocation, withSignIn(await savedSignIns(context), signIn));

export const removeSignIn = async (context: CommandContext, signIns: SignIn[], organization: Organization) =>
  writeSignInsFile(context.invocation, withoutSignIn(signIns, organization));
