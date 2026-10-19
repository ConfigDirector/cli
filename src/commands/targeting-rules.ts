import { AdminApiClient, type Environment } from "../admin-api/AdminApiClient.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configuredApiToken } from "../configured-api-token.js";
import { findEnvironmentBySlug } from "../environment-selection.js";
import { ExitCode } from "../ExitCode.js";
import type { JsonObject } from "../file-contents.js";
import { plural } from "../plural.js";
import { connectToLinkedProject } from "../project-selection.js";
import { targetingRulesReferenceText } from "../targeting-rules/reference-text.js";
import { readTargetingRulesFile, withGeneratedIds } from "../targeting-rules/targeting-rules-file.js";

type SetTargetingRulesOptions = { environment: string; rules: string };

const replacedRulesLine = (configKey: string, environment: Environment, targetingRules: JsonObject) => {
  const ruleCount = Array.isArray(targetingRules.rules) ? targetingRules.rules.length : 0;
  return (
    `Replaced the targeting rules of ${configKey} in ${environment.slug} with ` +
    `${ruleCount} ${plural(ruleCount, "rule", "rules")} and the default targeting rule value ` +
    `${String(targetingRules.defaultValue)}.`
  );
};

export const setTargetingRules = async (
  context: CommandContext,
  [configKey]: readonly [string],
  options: SetTargetingRulesOptions,
): Promise<CommandOutput> => {
  const targetingRules = withGeneratedIds(await readTargetingRulesFile(options.rules, context.invocation));
  const { client, project } = await connectToLinkedProject(context);
  const environment = await findEnvironmentBySlug(client, project, options.environment);
  const request = { ...targetingRules, environmentId: environment.id };
  const outcome = await client.replaceTargetingRules(project.id, configKey, request);
  if (outcome === "not-found") {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }

  return {
    json: request,
    text: [replacedRulesLine(configKey, environment, targetingRules), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};

export const showTargetingRulesReference = async (context: CommandContext): Promise<CommandOutput> => {
  const client = new AdminApiClient({
    baseUrl: context.baseUrl,
    token: (await configuredApiToken(context)).token,
  });
  const { parsedBody: reference, responseBody } = await client.getTargetingRulesReference();

  return { json: responseBody, text: targetingRulesReferenceText(reference), exitCode: ExitCode.success };
};
