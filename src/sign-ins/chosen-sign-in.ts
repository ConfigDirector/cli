import { CliError } from "../CliError.js";
import type { CommandContext } from "../CommandContext.js";
import type { ProjectSettings } from "../project-settings.js";
import type { SignIn } from "./sign-ins-file.js";

export type OrganizationReference =
  { from: "option"; reference: string } | { from: "settings-file"; reference: string } | { from: "nowhere" };

export const organizationReferenceOf = (
  context: CommandContext,
  settings: ProjectSettings | undefined,
): OrganizationReference => {
  if (context.organizationOption !== undefined) {
    return { from: "option", reference: context.organizationOption };
  }
  if (settings?.organization !== undefined) {
    return { from: "settings-file", reference: settings.organization };
  }
  return { from: "nowhere" };
};

const describeSignIn = (signIn: SignIn): string => `${signIn.organization.name} (${signIn.organization.id})`;

export const describeSignIns = (signIns: SignIn[]): string => signIns.map(describeSignIn).join(", ");

const sameName = (name: string, otherName: string): boolean =>
  name.localeCompare(otherName, undefined, { sensitivity: "accent" }) === 0;

const signInWithId = (signIns: SignIn[], organizationId: string): SignIn | undefined =>
  signIns.find((signIn) => signIn.organization.id === organizationId);

const signInNamedByOption = (signIns: SignIn[], reference: string): SignIn => {
  const signInWithReferenceAsId = signInWithId(signIns, reference);
  if (signInWithReferenceAsId !== undefined) {
    return signInWithReferenceAsId;
  }
  const signInsWithName = signIns.filter((signIn) => sameName(signIn.organization.name, reference));
  const [onlySignInWithName] = signInsWithName;
  if (signInsWithName.length > 1) {
    throw new CliError(
      `${signInsWithName.length} CLI sign-ins are named "${reference}": ${describeSignIns(signInsWithName)}. ` +
        "Name the organization by its id.",
    );
  }
  if (onlySignInWithName === undefined) {
    throw new CliError(
      `No CLI sign-in is for the organization "${reference}". The CLI sign-ins are for ${describeSignIns(signIns)}.`,
    );
  }
  return onlySignInWithName;
};

const signInNamedBySettingsFile = (signIns: SignIn[], organizationId: string): SignIn => {
  const signIn = signInWithId(signIns, organizationId);
  if (signIn === undefined) {
    throw new CliError(
      `No CLI sign-in is for the organization ${organizationId}, which configdirector.json names. ` +
        `The CLI sign-ins are for ${describeSignIns(signIns)}. Run \`configdirector login\` with a token of that organization.`,
    );
  }
  return signIn;
};

type SignInChoice = { outcome: "chosen"; signIn: SignIn } | { outcome: "no-sign-in" };

const onlySignIn = (signIns: SignIn[]): SignInChoice => {
  const [firstSignIn] = signIns;
  if (firstSignIn === undefined) {
    return { outcome: "no-sign-in" };
  }
  if (signIns.length > 1) {
    throw new CliError(
      `There are CLI sign-ins for ${describeSignIns(signIns)}. Name the organization with --organization, ` +
        "CONFIGDIRECTOR_ORGANIZATION or `organization` in configdirector.json, which `configdirector init` writes.",
    );
  }
  return { outcome: "chosen", signIn: firstSignIn };
};

export const chosenSignIn = (
  signIns: SignIn[],
  organizationReference: OrganizationReference,
): SignInChoice => {
  if (signIns.length === 0) {
    return { outcome: "no-sign-in" };
  }
  switch (organizationReference.from) {
    case "option":
      return { outcome: "chosen", signIn: signInNamedByOption(signIns, organizationReference.reference) };
    case "settings-file":
      return {
        outcome: "chosen",
        signIn: signInNamedBySettingsFile(signIns, organizationReference.reference),
      };
    case "nowhere":
      return onlySignIn(signIns);
  }
};
