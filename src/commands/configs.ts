import type {
  AdminApiClient,
  Config,
  ConfigActivity,
  ConfigTagFilter,
  ListedConfig,
  Project,
} from "../admin-api/AdminApiClient.js";
import { ifPermitted } from "../admin-api/admin-api-errors.js";
import type { ConfigWithTargetingRules } from "../admin-api/config-with-targeting-rules.js";
import { alignedColumns } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { configText } from "../configs/config-text.js";
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
  const tagIds: string[] = [];
  for (const name of options.tag) {
    tagIds.push(await tagIdNamed(client, project, name));
  }
  return { form: "tagged", tagIds };
};

const configsInState = (listedConfigs: ListedConfig[], state: LifecycleState | undefined): ListedConfig[] =>
  state === undefined
    ? listedConfigs
    : listedConfigs.filter((listedConfig) => listedConfig.config.state === state);

const configLines = (projectSlug: string, configs: Config[]): string[] =>
  configs.length === 0
    ? [`No configs found in ${projectSlug}.`]
    : alignedColumns(
        configs.map((config) => [config.key, config.type, config.role, config.lifetime, config.state]),
      );

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
