import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { readProjectSettings } from "../project-settings.js";
import { chosenSignIn, organizationReferenceOf } from "../sign-ins/chosen-sign-in.js";
import { removeSignIn, savedSignIns } from "../sign-ins/sign-ins.js";

export const logout = async (context: CommandContext): Promise<CommandOutput> => {
  if (context.tokenOption !== undefined) {
    throw new CliError("logout removes a CLI sign-in and sends no token, so it takes no --token.");
  }
  const settings = await readProjectSettings(context.invocation.workingDirectory);
  const signIns = await savedSignIns(context);
  const choice = chosenSignIn(signIns, organizationReferenceOf(context, settings));
  if (choice.outcome === "no-sign-in") {
    throw new CliError("There is no CLI sign-in on this machine to remove; `configdirector login` adds one.");
  }
  const { signIn } = choice;
  await removeSignIn(context, signIns, signIn.organization);

  return {
    json: { removedSignIn: { organization: signIn.organization } },
    text:
      `Signed out of ${signIn.organization.name}. ` +
      "The API token keeps working until it is revoked on the dashboard's API tokens page.\n",
    exitCode: ExitCode.success,
  };
};
