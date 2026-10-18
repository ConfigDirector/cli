import type { AdminApiClient, Environment, Project } from "../admin-api/AdminApiClient.js";
import { EvaluationNotFoundError, type EvaluationNotFoundCode } from "../admin-api/admin-api-errors.js";
import type { EvaluateConfigRequest } from "../admin-api/config-evaluation.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { findEnvironmentBySlug } from "../environment-selection.js";
import { contextFormOf, type ContextForm, type ContextOptions } from "../evaluate/context-form.js";
import { evaluationText } from "../evaluate/evaluation-text.js";
import { ExitCode } from "../ExitCode.js";
import { connectToLinkedProject } from "../project-selection.js";

type EvaluateOptions = ContextOptions & { environment: string };

const contextFieldsOf = (contextForm: ContextForm): Omit<EvaluateConfigRequest, "environmentId"> => {
  switch (contextForm.form) {
    case "inline":
      return { context: contextForm.context };
    case "saved":
      return { savedContext: contextForm.reference };
    case "empty":
      return {};
  }
};

type RequestedEvaluation = {
  project: Project;
  configKey: string;
  environment: Environment;
  contextForm: ContextForm;
};

const NOT_FOUND_MESSAGES: {
  [C in EvaluationNotFoundCode]: (requested: RequestedEvaluation, error: EvaluationNotFoundError) => string;
} = {
  CONFIG_NOT_FOUND: ({ project, configKey }) => `No config in ${project.slug} has the key "${configKey}".`,
  ENVIRONMENT_NOT_FOUND: ({ project, environment }) =>
    `No environment in ${project.slug} has the slug "${environment.slug}" any more.`,
  CONTEXT_NOT_FOUND: ({ environment, contextForm }, error) =>
    contextForm.form === "saved"
      ? `No context saved in ${environment.slug} has the context kind ${contextForm.reference.kind} ` +
        `and the identifier "${contextForm.reference.identifier}".`
      : error.message,
};

const requestEvaluation = async (client: AdminApiClient, requested: RequestedEvaluation) => {
  try {
    return await client.evaluateConfig(requested.project.id, requested.configKey, {
      environmentId: requested.environment.id,
      ...contextFieldsOf(requested.contextForm),
    });
  } catch (error) {
    if (error instanceof EvaluationNotFoundError) {
      throw new CliError(NOT_FOUND_MESSAGES[error.code](requested, error));
    }
    throw error;
  }
};

export const evaluate = async (
  context: CommandContext,
  [configKey]: readonly [string],
  options: EvaluateOptions,
): Promise<CommandOutput> => {
  const contextForm = await contextFormOf(options, context.invocation.workingDirectory);
  const { client, project } = await connectToLinkedProject(context);
  const environment = await findEnvironmentBySlug(client, project, options.environment);
  const requested = { project, configKey, environment, contextForm };
  const { evaluation, responseBody } = await requestEvaluation(client, requested);

  return {
    json: responseBody,
    text: evaluationText(evaluation, requested),
    exitCode: ExitCode.success,
  };
};
