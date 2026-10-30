import * as v from "valibot";
import { CliError } from "../CliError.js";

export const ApiAuthorizationErrorBodySchema = v.object({ error: v.string(), code: v.string() });

export const ApiValidationErrorBodySchema = v.object({
  errors: v.array(v.object({ name: v.optional(v.string()), message: v.string() })),
});

export const ServiceSuspendedBodySchema = v.object({ code: v.literal("SERVICE_SUSPENDED") });

export const RepositoryLimitReachedBodySchema = v.object({ code: v.literal("REPOSITORY_LIMIT_REACHED") });

export const ResourceNotFoundBodySchema = v.object({
  error: v.string(),
  code: v.pipe(v.string(), v.endsWith("_NOT_FOUND")),
});

type FieldError = v.InferOutput<typeof ApiValidationErrorBodySchema>["errors"][number];

const describeFieldError = (fieldError: FieldError): string =>
  fieldError.name === undefined ? fieldError.message : `${fieldError.name}: ${fieldError.message}`;

export class ApiAuthorizationError extends CliError {
  constructor(
    public readonly code: string,
    apiMessage: string,
  ) {
    super(`The Admin API refused the request: ${apiMessage} (${code})`);
  }
}

export const ifPermitted = async <Result>(request: Promise<Result>): Promise<Result | undefined> => {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiAuthorizationError && error.code === "INSUFFICIENT_PERMISSIONS") {
      return undefined;
    }
    throw error;
  }
};

export class ApiValidationError extends CliError {
  constructor(public readonly fieldErrors: FieldError[]) {
    super(
      `The Admin API rejected the request:\n${fieldErrors.map((error) => `  ${describeFieldError(error)}`).join("\n")}`,
    );
  }
}

export class ResourceNotFoundError extends CliError {
  constructor(
    public readonly code: string,
    apiMessage: string,
  ) {
    super(`${apiMessage} (${code})`);
  }
}

export class RepositoryLimitReachedError extends CliError {
  constructor() {
    super(
      "The project already holds its maximum of scanned repositories, so the Admin API refused the upload " +
        "(REPOSITORY_LIMIT_REACHED). Remove a repository it no longer needs with " +
        "`configdirector repositories remove <name>`, then upload again.",
    );
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
