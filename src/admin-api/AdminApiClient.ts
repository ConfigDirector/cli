import * as v from "valibot";
import { version } from "../../package.json";
import type { CliError } from "../CliError.js";
import {
  ApiAuthorizationError,
  ApiAuthorizationErrorBodySchema,
  ApiUnreachableError,
  ApiValidationError,
  ApiValidationErrorBodySchema,
  EvaluationNotFoundBodySchema,
  EvaluationNotFoundError,
  ServiceSuspendedBodySchema,
  ServiceSuspendedError,
  UnexpectedApiResponseError,
} from "./admin-api-errors.js";
import {
  ConfigEvaluationSchema,
  type EvaluateConfigRequest,
  type ReceivedConfigEvaluation,
} from "./config-evaluation.js";

const ProjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  slug: v.string(),
});

export type Project = v.InferOutput<typeof ProjectSchema>;

const configFields = {
  key: v.string(),
  deprecatedKeys: v.array(v.object({ key: v.string() })),
  client: v.boolean(),
  server: v.boolean(),
};

const EnumConfigSchema = v.object({
  ...configFields,
  type: v.literal("enum"),
  typeOptions: v.object({ valueType: v.string(), values: v.array(v.string()) }),
});

const ConfigSchema = v.variant("type", [
  EnumConfigSchema,
  v.object({ ...configFields, type: v.pipe(v.string(), v.notValue("enum")) }),
]);

export type Config = v.InferOutput<typeof ConfigSchema>;

type EnumConfig = v.InferOutput<typeof EnumConfigSchema>;

export const isEnumConfig = (config: Config): config is EnumConfig => config.type === "enum";

const EnvironmentSchema = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
});

export type Environment = v.InferOutput<typeof EnvironmentSchema>;

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
    case 404: {
      const notFoundError = v.safeParse(EvaluationNotFoundBodySchema, body);
      return notFoundError.success
        ? new EvaluationNotFoundError(notFoundError.output.code, notFoundError.output.error)
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

type JsonRequest = { method: "GET" } | { method: "POST"; body: object };

type ParsedResponse<TSchema extends v.GenericSchema> = {
  responseBody: unknown;
  parsedBody: v.InferOutput<TSchema>;
};

export class AdminApiClient {
  constructor(private readonly connection: { baseUrl: string; token: string }) {}

  public listProjects(): Promise<Project[]> {
    return this.get("/v1/projects", v.array(ProjectSchema));
  }

  public listConfigs(projectId: string): Promise<Config[]> {
    return this.get(`/v1/projects/${encodeURIComponent(projectId)}/configs`, v.array(ConfigSchema));
  }

  public listEnvironments(projectId: string): Promise<Environment[]> {
    return this.get(`/v1/projects/${encodeURIComponent(projectId)}/environments`, v.array(EnvironmentSchema));
  }

  public async evaluateConfig(
    projectId: string,
    configKey: string,
    request: EvaluateConfigRequest,
  ): Promise<ReceivedConfigEvaluation> {
    const { responseBody, parsedBody } = await this.requestJson(
      `/v1/projects/${encodeURIComponent(projectId)}/configs/${encodeURIComponent(configKey)}/evaluate`,
      ConfigEvaluationSchema,
      { method: "POST", body: request },
    );
    return { evaluation: parsedBody, responseBody };
  }

  private async get<TSchema extends v.GenericSchema>(
    path: string,
    schema: TSchema,
  ): Promise<v.InferOutput<TSchema>> {
    return (await this.requestJson(path, schema, { method: "GET" })).parsedBody;
  }

  private async requestJson<TSchema extends v.GenericSchema>(
    path: string,
    schema: TSchema,
    request: JsonRequest,
  ): Promise<ParsedResponse<TSchema>> {
    const url = `${this.connection.baseUrl}${path}`;
    const response = await this.fetchResponse(url, request);
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
    return { responseBody: body, parsedBody: parsedBody.output };
  }

  private async fetchResponse(url: string, request: JsonRequest): Promise<Response> {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${this.connection.token}`,
      "User-Agent": `configdirector-cli/${version}`,
      "X-SourceClient": "cli",
    };
    try {
      return await fetch(
        url,
        request.method === "POST"
          ? {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(request.body),
            }
          : { headers },
      );
    } catch (error) {
      throw new ApiUnreachableError(this.connection.baseUrl, error);
    }
  }
}
