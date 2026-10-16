import * as v from "valibot";
import { version } from "../../package.json";
import type { CliError } from "../CliError.js";
import {
  ApiAuthorizationError,
  ApiAuthorizationErrorBodySchema,
  ApiUnreachableError,
  ApiValidationError,
  ApiValidationErrorBodySchema,
  ServiceSuspendedBodySchema,
  ServiceSuspendedError,
  UnexpectedApiResponseError,
} from "./admin-api-errors.js";

const ProjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  slug: v.string(),
});

export type Project = v.InferOutput<typeof ProjectSchema>;

const readJsonBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const describeStatus = (response: Response): string => `HTTP ${response.status}`;

const failureFor = (url: string, response: Response, body: unknown): CliError => {
  switch (response.status) {
    case 400: {
      const validationError = v.safeParse(ApiValidationErrorBodySchema, body);
      return validationError.success
        ? new ApiValidationError(validationError.output.errors)
        : new UnexpectedApiResponseError(url, describeStatus(response));
    }
    case 403: {
      const authorizationError = v.safeParse(ApiAuthorizationErrorBodySchema, body);
      return authorizationError.success
        ? new ApiAuthorizationError(authorizationError.output.code, authorizationError.output.error)
        : new UnexpectedApiResponseError(url, describeStatus(response));
    }
    case 429: {
      const retryAfterSeconds = response.headers.get("retry-after");
      return v.is(ServiceSuspendedBodySchema, body) && retryAfterSeconds !== null
        ? new ServiceSuspendedError(retryAfterSeconds)
        : new UnexpectedApiResponseError(url, describeStatus(response));
    }
    default:
      return new UnexpectedApiResponseError(url, describeStatus(response));
  }
};

export class AdminApiClient {
  constructor(private readonly connection: { baseUrl: string; token: string }) {}

  public listProjects(): Promise<Project[]> {
    return this.get("/v1/projects", v.array(ProjectSchema));
  }

  private async get<TSchema extends v.GenericSchema>(
    path: string,
    schema: TSchema,
  ): Promise<v.InferOutput<TSchema>> {
    const url = `${this.connection.baseUrl}${path}`;
    const response = await this.fetchResponse(url);
    const body = await readJsonBody(response);
    if (!response.ok) {
      throw failureFor(url, response, body);
    }
    const parsedBody = v.safeParse(schema, body);
    if (!parsedBody.success) {
      throw new UnexpectedApiResponseError(
        url,
        `an ${describeStatus(response)} response the CLI cannot read`,
      );
    }
    return parsedBody.output;
  }

  private async fetchResponse(url: string): Promise<Response> {
    try {
      return await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.connection.token}`,
          "User-Agent": `configdirector-cli/${version}`,
          "X-SourceClient": "cli",
        },
      });
    } catch (error) {
      throw new ApiUnreachableError(this.connection.baseUrl, error);
    }
  }
}
