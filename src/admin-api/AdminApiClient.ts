import * as v from "valibot";
import { version } from "../../package.json";
import type { CliError } from "../CliError.js";
import {
  ApiAuthorizationError,
  ApiAuthorizationErrorBodySchema,
  ApiUnreachableError,
  ApiValidationError,
  ApiValidationErrorBodySchema,
  RepositoryLimitReachedBodySchema,
  RepositoryLimitReachedError,
  ResourceNotFoundBodySchema,
  ResourceNotFoundError,
  ServiceSuspendedBodySchema,
  ServiceSuspendedError,
  UnexpectedApiResponseError,
} from "./admin-api-errors.js";
import { CreatedConfigSchema, type CreateConfigRequest, type CreatedConfig } from "./config-creation.js";
import {
  ConfigWithTargetingRulesSchema,
  type ConfigWithTargetingRules,
} from "./config-with-targeting-rules.js";
import {
  ListedScannedRepositorySchema,
  ScannedRepositorySchema,
  type ListedScannedRepository,
  type RepositoryScanUpload,
  type ScannedRepository,
} from "./scanned-repositories.js";
import {
  SegmentDefinitionSchema,
  SegmentInUseBodySchema,
  SegmentSchema,
  type Segment,
  type SegmentDefinition,
  type SegmentUsage,
} from "./segments.js";
import { TargetingRulesReferenceSchema, type TargetingRulesReference } from "./targeting-rules-reference.js";
import {
  ConfigEvaluationSchema,
  type EvaluateConfigRequest,
  type ReceivedConfigEvaluation,
} from "./config-evaluation.js";

const ProjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  slug: v.string(),
  organizationId: v.string(),
  storeCodeSnippets: v.optional(v.boolean(), true),
});

export type Project = v.InferOutput<typeof ProjectSchema>;

const DescribedApiTokenSchema = v.object({
  name: v.string(),
  organization: v.object({ id: v.string(), name: v.string() }),
  permissions: v.array(v.string()),
  expiresAt: v.nullable(v.string()),
});

export type DescribedApiToken = v.InferOutput<typeof DescribedApiTokenSchema>;

const configFields = {
  key: v.string(),
  deprecatedKeys: v.array(v.object({ key: v.string() })),
  role: v.string(),
  lifetime: v.string(),
  state: v.string(),
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

export type ListedConfig = { config: Config; receivedConfig: unknown };

const EnvironmentSchema = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  live: v.boolean(),
});

export type Environment = v.InferOutput<typeof EnvironmentSchema>;

const ConfigActivitySchema = v.object({
  latestEvaluations: v.array(
    v.object({
      environment: v.object({ slug: v.string() }),
      source: v.string(),
      sdkName: v.nullable(v.string()),
      sdkVersion: v.nullable(v.string()),
      time: v.pipe(v.string(), v.isoTimestamp()),
    }),
  ),
});

export type ConfigActivity = v.InferOutput<typeof ConfigActivitySchema>;

const TagSchema = v.object({ id: v.string(), name: v.string() });

export type Tag = v.InferOutput<typeof TagSchema>;

export type ConfigTagFilter =
  { form: "every-config" } | { form: "tagged"; tagIds: string[] } | { form: "untagged" };

const tagFilterQuery = (tagFilter: ConfigTagFilter): string => {
  switch (tagFilter.form) {
    case "every-config":
      return "";
    case "tagged":
      return `?${new URLSearchParams(tagFilter.tagIds.map((tagId): [string, string] => ["tagIds", tagId]))}`;
    case "untagged":
      return "?untagged=true";
  }
};

type ReplaceTargetingRulesRequest = { [field: string]: unknown; environmentId: string };

type CreateSegmentRequest = { [field: string]: unknown };

type UpdateSegmentRequest = { [field: string]: unknown; id: string };

type TargetingRulesReplacementOutcome = "replaced" | "not-found";

type ConfigArchiveOutcome = "archived" | "not-found";

type SegmentDeletionOutcome =
  { outcome: "deleted" } | { outcome: "not-found" } | { outcome: "in-use"; usages: SegmentUsage[] };

type ScannedRepositoryRemovalOutcome = "removed" | "not-found";

const MissingResourceBodySchema = v.union([v.strictObject({}), ResourceNotFoundBodySchema]);

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
      if (v.is(RepositoryLimitReachedBodySchema, body)) {
        return new RepositoryLimitReachedError();
      }
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
      const notFoundError = v.safeParse(ResourceNotFoundBodySchema, body);
      return notFoundError.success
        ? new ResourceNotFoundError(notFoundError.output.code, notFoundError.output.error)
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

type JsonRequest = { method: "GET" | "DELETE" } | { method: "POST" | "PUT"; body: object };

type ReceivedResponse = { url: string; response: Response; body: unknown };

type ParsedResponse<Body> = {
  responseBody: unknown;
  parsedBody: Body;
};

const isMissingResource = (received: ReceivedResponse): boolean =>
  received.response.status === 404 && v.is(MissingResourceBodySchema, received.body);

type SegmentInUseResponse = ReceivedResponse & { body: v.InferOutput<typeof SegmentInUseBodySchema> };

const isSegmentInUse = (received: ReceivedResponse): received is SegmentInUseResponse =>
  received.response.status === 409 && v.is(SegmentInUseBodySchema, received.body);

const segmentDeletionOutcomeOf = (received: ReceivedResponse): SegmentDeletionOutcome => {
  if (isMissingResource(received)) {
    return { outcome: "not-found" };
  }
  if (isSegmentInUse(received)) {
    return { outcome: "in-use", usages: received.body.usages };
  }
  if (!received.response.ok) {
    throw failureFor(received.url, received.response, received.body);
  }
  return { outcome: "deleted" };
};

const parsedResponseOf = <TSchema extends v.GenericSchema>(
  { url, response, body }: ReceivedResponse,
  schema: TSchema,
): ParsedResponse<v.InferOutput<TSchema>> => {
  if (!response.ok) {
    throw failureFor(url, response, body);
  }
  const parsedBody = v.safeParse(schema, body);
  if (!parsedBody.success) {
    throw new UnexpectedApiResponseError(url, `an ${describeStatus(response)} response the CLI cannot read`);
  }
  return { responseBody: body, parsedBody: parsedBody.output };
};

export class AdminApiClient {
  constructor(private readonly connection: { baseUrl: string; token: string }) {}

  public describeApiToken(): Promise<ParsedResponse<DescribedApiToken>> {
    return this.get("/v1/api-token", DescribedApiTokenSchema);
  }

  public listProjects(): Promise<ParsedResponse<Project[]>> {
    return this.get("/v1/projects", v.array(ProjectSchema));
  }

  public async listConfigs(projectId: string, tagFilter: ConfigTagFilter): Promise<ListedConfig[]> {
    const { parsedBody: configs, responseBody } = await this.get(
      `/v1/projects/${encodeURIComponent(projectId)}/configs${tagFilterQuery(tagFilter)}`,
      v.array(ConfigSchema),
    );
    const receivedConfigs = v.parse(v.array(v.unknown()), responseBody);
    return configs.map((config, index) => ({ config, receivedConfig: receivedConfigs[index] }));
  }

  public listEnvironments(projectId: string): Promise<ParsedResponse<Environment[]>> {
    return this.get(`/v1/projects/${encodeURIComponent(projectId)}/environments`, v.array(EnvironmentSchema));
  }

  public getConfig(
    projectId: string,
    configKey: string,
  ): Promise<ParsedResponse<ConfigWithTargetingRules> | undefined> {
    return this.getIfFound(
      `/v1/projects/${encodeURIComponent(projectId)}/configs/${encodeURIComponent(configKey)}`,
      ConfigWithTargetingRulesSchema,
    );
  }

  public getConfigActivity(
    projectId: string,
    configKey: string,
  ): Promise<ParsedResponse<ConfigActivity> | undefined> {
    return this.getIfFound(
      `/v1/projects/${encodeURIComponent(projectId)}/configs/${encodeURIComponent(configKey)}/activity`,
      ConfigActivitySchema,
    );
  }

  public listSegments(projectId: string): Promise<ParsedResponse<Segment[]>> {
    return this.get(`/v1/projects/${encodeURIComponent(projectId)}/segments`, v.array(SegmentSchema));
  }

  public getSegment(
    projectId: string,
    segmentKey: string,
  ): Promise<ParsedResponse<SegmentDefinition> | undefined> {
    return this.getIfFound(
      `/v1/projects/${encodeURIComponent(projectId)}/segments/${encodeURIComponent(segmentKey)}`,
      SegmentDefinitionSchema,
    );
  }

  public createSegment(
    projectId: string,
    request: CreateSegmentRequest,
  ): Promise<ParsedResponse<SegmentDefinition>> {
    return this.requestJson(
      `/v1/projects/${encodeURIComponent(projectId)}/segments`,
      SegmentDefinitionSchema,
      { method: "POST", body: request },
    );
  }

  public updateSegment(
    projectId: string,
    segmentKey: string,
    request: UpdateSegmentRequest,
  ): Promise<ParsedResponse<SegmentDefinition> | undefined> {
    return this.requestIfFound(
      `/v1/projects/${encodeURIComponent(projectId)}/segments/${encodeURIComponent(segmentKey)}`,
      SegmentDefinitionSchema,
      { method: "PUT", body: request },
    );
  }

  public async deleteSegment(projectId: string, segmentKey: string): Promise<SegmentDeletionOutcome> {
    return segmentDeletionOutcomeOf(
      await this.send(
        `/v1/projects/${encodeURIComponent(projectId)}/segments/${encodeURIComponent(segmentKey)}`,
        { method: "DELETE" },
      ),
    );
  }

  public async findTagByName(projectId: string, name: string): Promise<Tag | undefined> {
    return (
      await this.getIfFound(
        `/v1/projects/${encodeURIComponent(projectId)}/tags/by-name?${new URLSearchParams({ name })}`,
        TagSchema,
      )
    )?.parsedBody;
  }

  public async createTag(projectId: string, name: string): Promise<Tag> {
    return (
      await this.requestJson(`/v1/projects/${encodeURIComponent(projectId)}/tags`, TagSchema, {
        method: "POST",
        body: { name },
      })
    ).parsedBody;
  }

  public createConfig(
    projectId: string,
    request: CreateConfigRequest,
  ): Promise<ParsedResponse<CreatedConfig>> {
    return this.requestJson(`/v1/projects/${encodeURIComponent(projectId)}/configs`, CreatedConfigSchema, {
      method: "POST",
      body: request,
    });
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

  public getTargetingRulesReference(): Promise<ParsedResponse<TargetingRulesReference>> {
    return this.get("/v1/targeting-rules-reference", TargetingRulesReferenceSchema);
  }

  public async replaceTargetingRules(
    projectId: string,
    configKey: string,
    request: ReplaceTargetingRulesRequest,
  ): Promise<TargetingRulesReplacementOutcome> {
    const response = await this.requestIfFound(
      `/v1/projects/${encodeURIComponent(projectId)}/configs/${encodeURIComponent(configKey)}/targets`,
      v.unknown(),
      { method: "PUT", body: request },
    );
    return response === undefined ? "not-found" : "replaced";
  }

  public uploadRepositoryScan(
    projectId: string,
    repositoryName: string,
    upload: RepositoryScanUpload,
  ): Promise<ParsedResponse<ScannedRepository>> {
    return this.requestJson(
      `/v1/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repositoryName)}`,
      ScannedRepositorySchema,
      { method: "PUT", body: upload },
    );
  }

  public listScannedRepositories(projectId: string): Promise<ParsedResponse<ListedScannedRepository[]>> {
    return this.get(
      `/v1/projects/${encodeURIComponent(projectId)}/repositories`,
      v.array(ListedScannedRepositorySchema),
    );
  }

  public async removeScannedRepository(
    projectId: string,
    repositoryName: string,
  ): Promise<ScannedRepositoryRemovalOutcome> {
    const response = await this.requestIfFound(
      `/v1/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repositoryName)}`,
      v.unknown(),
      { method: "DELETE" },
    );
    return response === undefined ? "not-found" : "removed";
  }

  public async archiveConfig(projectId: string, configKey: string): Promise<ConfigArchiveOutcome> {
    const response = await this.requestIfFound(
      `/v1/projects/${encodeURIComponent(projectId)}/configs/${encodeURIComponent(configKey)}`,
      v.unknown(),
      { method: "DELETE" },
    );
    return response === undefined ? "not-found" : "archived";
  }

  private get<TSchema extends v.GenericSchema>(
    path: string,
    schema: TSchema,
  ): Promise<ParsedResponse<v.InferOutput<TSchema>>> {
    return this.requestJson(path, schema, { method: "GET" });
  }

  private getIfFound<TSchema extends v.GenericSchema>(
    path: string,
    schema: TSchema,
  ): Promise<ParsedResponse<v.InferOutput<TSchema>> | undefined> {
    return this.requestIfFound(path, schema, { method: "GET" });
  }

  private async requestIfFound<TSchema extends v.GenericSchema>(
    path: string,
    schema: TSchema,
    request: JsonRequest,
  ): Promise<ParsedResponse<v.InferOutput<TSchema>> | undefined> {
    const received = await this.send(path, request);
    return isMissingResource(received) ? undefined : parsedResponseOf(received, schema);
  }

  private async requestJson<TSchema extends v.GenericSchema>(
    path: string,
    schema: TSchema,
    request: JsonRequest,
  ): Promise<ParsedResponse<v.InferOutput<TSchema>>> {
    return parsedResponseOf(await this.send(path, request), schema);
  }

  private async send(path: string, request: JsonRequest): Promise<ReceivedResponse> {
    const url = `${this.connection.baseUrl}${path}`;
    const response = await this.fetchResponse(url, request);
    return { url, response, body: await readJsonBody(response) };
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
        "body" in request
          ? {
              method: request.method,
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(request.body),
            }
          : { method: request.method, headers },
      );
    } catch (error) {
      throw new ApiUnreachableError(this.connection.baseUrl, error);
    }
  }
}
