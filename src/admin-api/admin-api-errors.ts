import * as v from "valibot";
import { CliError } from "../CliError.js";

export const ApiAuthorizationErrorBodySchema = v.object({ error: v.string(), code: v.string() });

export const ApiValidationErrorBodySchema = v.object({
  errors: v.array(v.object({ name: v.optional(v.string()), message: v.string() })),
});

export const ServiceSuspendedBodySchema = v.object({ code: v.literal("SERVICE_SUSPENDED") });

export const EvaluationNotFoundBodySchema = v.object({
  error: v.string(),
  code: v.picklist(["CONFIG_NOT_FOUND", "ENVIRONMENT_NOT_FOUND", "CONTEXT_NOT_FOUND"]),
});

export type EvaluationNotFoundCode = v.InferOutput<typeof EvaluationNotFoundBodySchema>["code"];

type FieldError = v.InferOutput<typeof ApiValidationErrorBodySchema>["errors"][number];

const describeFieldError = (fieldError: FieldError): string =>
  fieldError.name === undefined ? fieldError.message : `${fieldError.name}: ${fieldError.message}`;

export class ApiAuthorizationError extends CliError {
  constructor(code: string, apiMessage: string) {
    super(`The Admin API refused the request: ${apiMessage} (${code})`);
  }
}

export class ApiValidationError extends CliError {
  constructor(errors: FieldError[]) {
    super(
      `The Admin API rejected the request:\n${errors.map((error) => `  ${describeFieldError(error)}`).join("\n")}`,
    );
  }
}

export class EvaluationNotFoundError extends CliError {
  constructor(
    public readonly code: EvaluationNotFoundCode,
    apiMessage: string,
  ) {
    super(`The Admin API could not evaluate the config: ${apiMessage} (${code})`);
  }
}

export class ServiceSuspendedError extends CliError {
  constructor(retryAfterSeconds: string) {
    super(
      "Your organization's service is suspended, so ConfigDirector refuses Admin API requests. " +
        "The dashboard's billing page shows why and how to reinstate it. " +
        `Retry after ${retryAfterSeconds} seconds.`,
    );
  }
}

export class ApiUnreachableError extends CliError {
  constructor(baseUrl: string, cause: unknown) {
    const reason =
      cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : String(cause);
    super(
      `Could not reach the Admin API at ${baseUrl} (${reason}). ` +
        "Check the network connection, --base-url or CONFIGDIRECTOR_BASE_URL.",
    );
  }
}

export class UnexpectedApiResponseError extends CliError {
  constructor(url: string, description: string) {
    super(`The Admin API answered ${url} with ${description}.`);
  }
}
