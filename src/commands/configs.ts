import type {
  AdminApiClient,
  Config,
  ConfigActivity,
  ConfigTagFilter,
  ListedConfig,
  Project,
} from "../admin-api/AdminApiClient.js";
import { ApiValidationError, ifPermitted } from "../admin-api/admin-api-errors.js";
import type { CreateConfigRequest, CreatedConfig } from "../admin-api/config-creation.js";
import type { ConfigWithTargetingRules } from "../admin-api/config-with-targeting-rules.js";
import { alignedColumns } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { availabilityDescription, configText } from "../configs/config-text.js";
import { newConfigOf, type NewConfig, type NewConfigOptions } from "../configs/new-config.js";
import { ExitCode } from "../ExitCode.js";
import { connectToLinkedProject } from "../project-selection.js";
import type { SegmentsById } from "../rule-sentences.js";

export const LIFECYCLE_STATES = ["new", "in-use", "settled", "archive-ready", "stale"] as const;

type LifecycleState = (typeof LIFECYCLE_STATES)[number];

type ListConfigsOptions = { tag?: string[]; untagged?: true; state?: LifecycleState };

const tagIdNamed = async (client: AdminApiClient, project: Project, name: string): Promise<string> => {
  const tag = await client.findTagByName(project.id, name);
  if (tag === undefined) {
    throw new CliError(`No tag in ${project.slug} has the name "${name}".`);
  }
  return tag.id;
};

const tagIdsNamed = async (client: AdminApiClient, project: Project, names: string[]): Promise<string[]> => {
  const tagIds: string[] = [];
  for (const name of names) {
    tagIds.push(await tagIdNamed(client, project, name));
  }
  return tagIds;
};

const tagFilterOf = async (
  client: AdminApiClient,
  project: Project,
  options: ListConfigsOptions,
): Promise<ConfigTagFilter> => {
  if (options.untagged) {
    return { form: "untagged" };
  }
  if (options.tag === undefined) {
    return { form: "every-config" };
  }
  return { form: "tagged", tagIds: await tagIdsNamed(client, project, options.tag) };
};

const configsInState = (listedConfigs: ListedConfig[], state: LifecycleState | undefined): ListedConfig[] =>
  state === undefined
    ? listedConfigs
    : listedConfigs.filter((listedConfig) => listedConfig.config.state === state);

type ConfigSummary = Pick<Config, "key" | "type" | "role" | "lifetime" | "state">;

const summaryColumnsOf = (config: ConfigSummary): string[] => [
  config.key,
  config.type,
  config.role,
  config.lifetime,
  config.state,
];

const configLines = (projectSlug: string, configs: Config[]): string[] =>
  configs.length === 0
    ? [`No configs found in ${projectSlug}.`]
    : alignedColumns(configs.map(summaryColumnsOf));

export const listConfigs = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: ListConfigsOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const listedConfigs = configsInState(
    await client.listConfigs(project.id, await tagFilterOf(client, project, options)),
    options.state,
  );

  return {
    json: listedConfigs.map((listedConfig) => listedConfig.receivedConfig),
    text: [
      ...configLines(
        project.slug,
        listedConfigs.map((listedConfig) => listedConfig.config),
      ),
      "",
    ].join("\n"),
    exitCode: ExitCode.success,
  };
};

const referencesSegments = (config: ConfigWithTargetingRules): boolean =>
  config.targets.some((targetingRules) =>
    targetingRules.rules.some(
      (rule) =>
        rule.type === "conditional" && rule.conditions.some((condition) => condition.kind === "segment"),
    ),
  );

const segmentNamesFor = async (
  client: AdminApiClient,
  project: Project,
  config: ConfigWithTargetingRules,
): Promise<SegmentsById> => {
  if (!referencesSegments(config)) {
    return {};
  }
  const segments = await ifPermitted(client.listSegments(project.id));
  return Object.fromEntries((segments?.parsedBody ?? []).map((segment) => [segment.id, segment]));
};

export const getConfig = async (
  context: CommandContext,
  [configKey]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const receivedConfig = await client.getConfig(project.id, configKey);
  if (receivedConfig === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }
  const { parsedBody: config, responseBody } = receivedConfig;

  return {
    json: responseBody,
    text: configText(config, configKey, await segmentNamesFor(client, project, config)),
    exitCode: ExitCode.success,
  };
};

const createdConfigLines = (projectSlug: string, createdConfig: CreatedConfig, newConfig: NewConfig) => {
  const settings = [
    createdConfig.type,
    createdConfig.role,
    createdConfig.lifetime,
    availabilityDescription(createdConfig),
  ];
  return [
    `Created ${createdConfig.key} in ${projectSlug}: ${settings.join(", ")}.`,
    `Default targeting rule in every environment: ${String(newConfig.defaultValue)}`,
  ];
};

const keyTakenLines = (projectSlug: string, configKey: string, existingConfig: ConfigSummary) => [
  `${projectSlug} already has a config with the key ${configKey}, so no config was created:`,
  ...alignedColumns([summaryColumnsOf(existingConfig)]),
];

type CreationOutcome =
  | { outcome: "created"; createdConfig: CreatedConfig; responseBody: unknown }
  | { outcome: "key-taken"; existingConfig: ConfigWithTargetingRules; responseBody: unknown };

const rejectsKey = (error: unknown): boolean =>
  error instanceof ApiValidationError && error.fieldErrors.some((fieldError) => fieldError.name === "key");

const requestCreation = async (
  client: AdminApiClient,
  project: Project,
  request: CreateConfigRequest,
): Promise<CreationOutcome> => {
  try {
    const { parsedBody: createdConfig, responseBody } = await client.createConfig(project.id, request);
    return { outcome: "created", createdConfig, responseBody };
  } catch (error) {
    if (!rejectsKey(error)) {
      throw error;
    }
    const existingConfig = await client.getConfig(project.id, request.key);
    if (existingConfig === undefined) {
      throw error;
    }
    return {
      outcome: "key-taken",
      existingConfig: existingConfig.parsedBody,
      responseBody: existingConfig.responseBody,
    };
  }
};

const creationOutput = (project: Project, newConfig: NewConfig, creation: CreationOutcome): CommandOutput => {
  switch (creation.outcome) {
    case "created":
      return {
        json: creation.responseBody,
        text: [...createdConfigLines(project.slug, creation.createdConfig, newConfig), ""].join("\n"),
        exitCode: ExitCode.success,
      };
    case "key-taken":
      return {
        json: creation.responseBody,
        text: [...keyTakenLines(project.slug, newConfig.key, creation.existingConfig), ""].join("\n"),
        exitCode: ExitCode.problemsFound,
      };
  }
};

type CreateConfigOptions = NewConfigOptions & { tag?: string[] };

export const createConfig = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: CreateConfigOptions,
): Promise<CommandOutput> => {
  const newConfig = await newConfigOf(options, context.invocation.workingDirectory);
  const { client, project } = await connectToLinkedProject(context);
  const creation = await requestCreation(client, project, {
    ...newConfig,
    tagIds: await tagIdsNamed(client, project, options.tag ?? []),
  });

  return creationOutput(project, newConfig, creation);
};

export const archiveConfig = async (
  context: CommandContext,
  [configKey]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const outcome = await client.archiveConfig(project.id, configKey);
  if (outcome === "not-found") {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }

  return {
    json: { archivedConfigKey: configKey },
    text: [
      `Archived ${configKey} in ${project.slug}. It can be restored from the dashboard for 30 days.`,
      "",
    ].join("\n"),
    exitCode: ExitCode.success,
  };
};

type LatestEvaluation = ConfigActivity["latestEvaluations"][number];

const sdkDescription = (evaluation: LatestEvaluation): string =>
  [
    evaluation.sdkName ?? "unknown SDK",
    ...(evaluation.sdkVersion === null ? [] : [evaluation.sdkVersion]),
  ].join(" ");

const utcMinute = (time: string): string => {
  const isoTime = new Date(time).toISOString();
  return `${isoTime.slice(0, 10)} ${isoTime.slice(11, 16)} UTC`;
};

const activityLines = (configKey: string, activity: ConfigActivity): string[] =>
  activity.latestEvaluations.length === 0
    ? [`No SDK evaluations of ${configKey} found.`]
    : alignedColumns(
        activity.latestEvaluations.map((evaluation) => [
          evaluation.environment.slug,
          evaluation.source,
          sdkDescription(evaluation),
          utcMinute(evaluation.time),
        ]),
      );

export const showConfigActivity = async (
  context: CommandContext,
  [configKey]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const receivedActivity = await client.getConfigActivity(project.id, configKey);
  if (receivedActivity === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }

  return {
    json: receivedActivity.responseBody,
    text: [...activityLines(configKey, receivedActivity.parsedBody), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
