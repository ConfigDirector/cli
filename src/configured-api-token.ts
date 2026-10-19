import { CliError } from "./CliError.js";
import type { CommandContext } from "./CommandContext.js";
import { nonEmptyVariable } from "./Invocation.js";
import { readProjectSettings } from "./project-settings.js";
import {
  chosenSignIn,
  organizationReferenceOf,
  type OrganizationReference,
} from "./sign-ins/chosen-sign-in.js";
import type { SignIn } from "./sign-ins/sign-ins-file.js";
import { savedSignIns } from "./sign-ins/sign-ins.js";

export type ApiTokenSource =
  { from: "token-option" } | { from: "token-variable" } | { from: "sign-in"; signIn: SignIn };

export type ConfiguredApiToken = { token: string; source: ApiTokenSource };

export const describeApiTokenSource = (source: ApiTokenSource): string => {
  switch (source.from) {
    case "token-option":
      return "--token";
    case "token-variable":
      return "CONFIGDIRECTOR_TOKEN";
    case "sign-in":
      return `the CLI sign-in for ${source.signIn.organization.name}`;
  }
};

const refuseOrganizationWithExplicitToken = (context: CommandContext): void => {
  if (context.organizationOption !== undefined) {
    throw new CliError(
      "--organization and CONFIGDIRECTOR_ORGANIZATION pick a CLI sign-in, " +
        "so neither can be used together with --token or CONFIGDIRECTOR_TOKEN.",
    );
  }
};

const explicitApiToken = (context: CommandContext): ConfiguredApiToken | undefined => {
  if (context.tokenOption !== undefined) {
    refuseOrganizationWithExplicitToken(context);
    return { token: context.tokenOption, source: { from: "token-option" } };
  }
  const tokenVariable = nonEmptyVariable(context.invocation, "CONFIGDIRECTOR_TOKEN");
  if (tokenVariable !== undefined) {
    refuseOrganizationWithExplicitToken(context);
    return { token: tokenVariable, source: { from: "token-variable" } };
  }
  return undefined;
};

const signInApiToken = (signIn: SignIn): ConfiguredApiToken => ({
  token: signIn.token,
  source: { from: "sign-in", signIn },
});

const chosenSignInApiToken = (
  signIns: SignIn[],
  organizationReference: OrganizationReference,
): ConfiguredApiToken => {
  const choice = chosenSignIn(signIns, organizationReference);
  switch (choice.outcome) {
    case "chosen":
      return signInApiToken(choice.signIn);
    case "no-sign-in":
      throw new CliError(
        "No API token found. Set CONFIGDIRECTOR_TOKEN, pass --token, or run `configdirector login`.",
      );
  }
};

export const apiTokensToSearch = async (context: CommandContext): Promise<ConfiguredApiToken[]> => {
  const explicitToken = explicitApiToken(context);
  if (explicitToken !== undefined) {
    return [explicitToken];
  }
  const signIns = await savedSignIns(context);
  const organizationReference = organizationReferenceOf(context, undefined);
  if (organizationReference.from === "nowhere" && signIns.length > 0) {
    return signIns.map(signInApiToken);
  }
  return [chosenSignInApiToken(signIns, organizationReference)];
};

export const configuredApiToken = async (context: CommandContext): Promise<ConfiguredApiToken> => {
  const explicitToken = explicitApiToken(context);
  if (explicitToken !== undefined) {
    return explicitToken;
  }
  const settings = await readProjectSettings(context.invocation.workingDirectory);
  const signIns = await savedSignIns(context);
  return chosenSignInApiToken(signIns, organizationReferenceOf(context, settings));
};
