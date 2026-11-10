import type {
  AdminApiClient,
  Config,
  ConfigActivity,
  ConfigTagFilter,
  ListedConfig,
  Project,
  Tag,
} from "../admin-api/AdminApiClient.js";
import { ApiValidationError, ifPermitted } from "../admin-api/admin-api-errors.js";
import type { CreateConfigRequest, CreatedConfig } from "../admin-api/config-creation.js";
import type { ConfigWithTargetingRules } from "../admin-api/config-with-targeting-rules.js";
import type { RunEndRequest } from "../admin-api/experiment-runs.js";
import { alignedColumns, alignedListing, type ListingOptions } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { availabilityDescription, configText } from "../configs/config-text.js";
import { copyPlanText, type ConfigCopying, type CopyMode } from "../configs/copy-plan-text.js";
import { environmentMappingOf } from "../configs/environment-mapping.js";
import { newConfigOf, type NewConfig, type NewConfigOptions } from "../configs/new-config.js";
import { runsText, shippedVariationText, stoppedRunText } from "../configs/run-text.js";
import { findVariationToShip } from "../configs/variation-selection.js";
import { findEnvironmentBySlug } from "../environment-selection.js";
import { ExitCode } from "../ExitCode.js";
import { plural } from "../plural.js";
import { connectToLinkedProject, projectWithSlug } from "../project-selection.js";
import { valueWithVariationName, type SegmentsById } from "../rule-sentences.js";
import { utcMinute } from "../utc-minute.js";

export const LIFECYCLE_STATES = ["new", "in-use", "settled", "archive-ready", "stale"] as const;

type LifecycleState = (typeof LIFECYCLE_STATES)[number];

type ListConfigsOptions = ListingOptions & { tag?: string[]; untagged?: true; state?: LifecycleState };

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

const CONFIG_SUMMARY_HEADER_ROW = ["KEY", "TYPE", "ROLE", "LIFETIME", "STATE"];

const summaryColumnsOf = (config: ConfigSummary): string[] => [
  config.key,
  config.type,
  config.role,
  config.lifetime,
  config.state,
];

const configLines = (projectSlug: string, configs: Config[], options: ListingOptions): string[] =>
  configs.length === 0
    ? [`No configs found in ${projectSlug}.`]
    : alignedListing(CONFIG_SUMMARY_HEADER_ROW, configs.map(summaryColumnsOf), options);

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
        options,
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

const defaultValueDescription = (newConfig: NewConfig): string => {
  const defaultVariation = newConfig.variations.find(
    (variation) => variation.value === newConfig.defaultValue,
  );
  return valueWithVariationName(newConfig.defaultValue, defaultVariation?.name);
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
    `Default targeting rule in every environment: ${defaultValueDescription(newConfig)}`,
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

type CreateConfigOptions = NewConfigOptions & { tag?: string[]; newTag?: string[] };

type ConfigTagNames = { existingTagNames: string[]; newTagNames: string[] };

const MAXIMUM_CONFIG_TAGS = 20;

const sameTagName = (name: string, otherName: string): boolean =>
  name.toLowerCase() === otherName.toLowerCase();

const configTagNamesOf = (options: CreateConfigOptions): ConfigTagNames => {
  const existingTagNames = options.tag ?? [];
  const newTagNames = options.newTag ?? [];
  const repeatedNewTagName = newTagNames.find((name, index) =>
    newTagNames.slice(0, index).some((earlierName) => sameTagName(earlierName, name)),
  );
  if (repeatedNewTagName !== undefined) {
    throw new CliError(
      `--new-tag gives the tag name "${repeatedNewTagName}" more than once. Case doesn't matter in tag names.`,
    );
  }
  const nameInBothOptions = newTagNames.find((name) =>
    existingTagNames.some((existingTagName) => sameTagName(existingTagName, name)),
  );
  if (nameInBothOptions !== undefined) {
    throw new CliError(
      `--tag and --new-tag both give the tag name "${nameInBothOptions}". Case doesn't matter in tag names. ` +
        "Use --tag for a tag the project has and --new-tag for a tag to create.",
    );
  }
  const tagCount = existingTagNames.length + newTagNames.length;
  if (tagCount > MAXIMUM_CONFIG_TAGS) {
    throw new CliError(
      `--tag and --new-tag give ${tagCount} tags, but a config can have at most ${MAXIMUM_CONFIG_TAGS}.`,
    );
  }
  return { existingTagNames, newTagNames };
};

const createNewTag = async (client: AdminApiClient, project: Project, name: string): Promise<Tag> => {
  try {
    return await client.createTag(project.id, name);
  } catch (error) {
    if (error instanceof ApiValidationError) {
      throw new CliError(
        `${error.message}\nTo assign a tag the project already has, use --tag instead of --new-tag.`,
      );
    }
    throw error;
  }
};

type CreationEnding = CreationOutcome["outcome"] | "failed";

const CREATED_TAGS_LEFT_UNASSIGNED: { [E in CreationEnding]: boolean } = {
  created: false,
  "key-taken": true,
  failed: true,
};

type UnassignedTagsNotice = { form: "none" } | { form: "tags-left-unassigned"; tags: [Tag, ...Tag[]] };

const unassignedTagsNoticeOf = (createdTags: Tag[], ending: CreationEnding): UnassignedTagsNotice => {
  const [firstTag, ...laterTags] = createdTags;
  return firstTag !== undefined && CREATED_TAGS_LEFT_UNASSIGNED[ending]
    ? { form: "tags-left-unassigned", tags: [firstTag, ...laterTags] }
    : { form: "none" };
};

const quotedTagName = (tag: Tag): string => `"${tag.name}"`;

const quotedTagNames = ([firstTag, ...laterTags]: [Tag, ...Tag[]]): string => {
  const lastTag = laterTags.at(-1);
  return lastTag === undefined
    ? quotedTagName(firstTag)
    : `${[firstTag, ...laterTags.slice(0, -1)].map(quotedTagName).join(", ")} and ${quotedTagName(lastTag)}`;
};

const unassignedTagsText = (project: Project, tags: [Tag, ...Tag[]]): string => {
  const count = tags.length;
  return (
    `Created the ${plural(count, "tag", "tags")} ${quotedTagNames(tags)}. ` +
    `${plural(count, "It stays", "They stay")} in ${project.slug}'s tag catalog, ` +
    `so pass ${plural(count, "it", "them")} with --tag next time.`
  );
};

const writeUnassignedTagsNotice = (
  context: CommandContext,
  project: Project,
  createdTags: Tag[],
  ending: CreationEnding,
): void => {
  const notice = unassignedTagsNoticeOf(createdTags, ending);
  switch (notice.form) {
    case "none":
      return;
    case "tags-left-unassigned":
      context.invocation.stderr.write(`${unassignedTagsText(project, notice.tags)}\n`);
      return;
  }
};

export const createConfig = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: CreateConfigOptions,
): Promise<CommandOutput> => {
  const newConfig = await newConfigOf(options, context.invocation.workingDirectory);
  const tagNames = configTagNamesOf(options);
  const { client, project } = await connectToLinkedProject(context);
  const existingTagIds = await tagIdsNamed(client, project, tagNames.existingTagNames);
  const createdTags: Tag[] = [];
  try {
    for (const name of tagNames.newTagNames) {
      createdTags.push(await createNewTag(client, project, name));
    }
    const creation = await requestCreation(client, project, {
      ...newConfig,
      tagIds: [...existingTagIds, ...createdTags.map((tag) => tag.id)],
    });
    writeUnassignedTagsNotice(context, project, createdTags, creation.outcome);

    return creationOutput(project, newConfig, creation);
  } catch (error) {
    writeUnassignedTagsNotice(context, project, createdTags, "failed");
    throw error;
  }
};

type CopyConfigOptions = { key: string; to?: string; environment?: string[]; dryRun?: true };

export const copyConfig = async (
  context: CommandContext,
  [configKey]: readonly [string],
  options: CopyConfigOptions,
): Promise<CommandOutput> => {
  const environmentMapping = environmentMappingOf(options.environment);
  const mode: CopyMode = options.dryRun ? "dry-run" : "copy";
  const { client, project, organizationProjects } = await connectToLinkedProject(context);
  const copying: ConfigCopying = {
    sourceKey: configKey,
    sourceProject: project,
    copyKey: options.key,
    destinationProject:
      options.to === undefined ? project : projectWithSlug(organizationProjects, options.to),
  };
  const receivedPlan = await client.copyConfig(project.id, configKey, {
    projectId: copying.destinationProject.id,
    key: copying.copyKey,
    environments: environmentMapping,
    dryRun: mode === "dry-run",
  });
  if (receivedPlan === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }

  return {
    json: receivedPlan.responseBody,
    text: copyPlanText(copying, receivedPlan.parsedBody.plan, mode),
    exitCode: ExitCode.success,
  };
};

type ConfigInEnvironmentOptions = { environment: string };

export const showConfigRuns = async (
  context: CommandContext,
  [configKey]: readonly [string],
  options: ConfigInEnvironmentOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const environment = await findEnvironmentBySlug(client, project, options.environment);
  const receivedConfig = await client.getConfig(project.id, configKey);
  const receivedRuns = receivedConfig && (await client.listRuns(project.id, configKey, environment.id));
  if (receivedConfig === undefined || receivedRuns === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }

  return {
    json: receivedRuns.responseBody,
    text: runsText(receivedConfig.parsedBody, configKey, environment, receivedRuns.parsedBody),
    exitCode: ExitCode.success,
  };
};

type RunEndOptions = ConfigInEnvironmentOptions & { note?: string };

const runEndRequestOf = (options: RunEndOptions): RunEndRequest =>
  options.note === undefined ? {} : { note: options.note };

type ShipVariationOptions = RunEndOptions & { variation: string };

export const shipVariation = async (
  context: CommandContext,
  [configKey]: readonly [string],
  options: ShipVariationOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const environment = await findEnvironmentBySlug(client, project, options.environment);
  const receivedConfig = await client.getConfig(project.id, configKey);
  if (receivedConfig === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }
  const variation = findVariationToShip(receivedConfig.parsedBody, options.variation);
  const savedConfig = await client.shipVariation(project.id, configKey, environment.id, {
    variationId: variation.id,
    ...runEndRequestOf(options),
  });
  if (savedConfig === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }
  const segments = await segmentNamesFor(client, project, savedConfig.parsedBody);

  return {
    json: savedConfig.responseBody,
    text: shippedVariationText(
      { config: savedConfig.parsedBody, requestedKey: configKey, environment, segments },
      variation,
    ),
    exitCode: ExitCode.success,
  };
};

export const stopRun = async (
  context: CommandContext,
  [configKey]: readonly [string],
  options: RunEndOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const environment = await findEnvironmentBySlug(client, project, options.environment);
  const savedConfig = await client.stopRun(project.id, configKey, environment.id, runEndRequestOf(options));
  if (savedConfig === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }
  const segments = await segmentNamesFor(client, project, savedConfig.parsedBody);

  return {
    json: savedConfig.responseBody,
    text: stoppedRunText({ config: savedConfig.parsedBody, requestedKey: configKey, environment, segments }),
    exitCode: ExitCode.success,
  };
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

const LATEST_EVALUATION_HEADER_ROW = ["ENVIRONMENT", "SDK KEY", "SDK", "LAST EVALUATED"];

const activityLines = (configKey: string, activity: ConfigActivity, options: ListingOptions): string[] =>
  activity.latestEvaluations.length === 0
    ? [`No SDK evaluations of ${configKey} found.`]
    : alignedListing(
        LATEST_EVALUATION_HEADER_ROW,
        activity.latestEvaluations.map((evaluation) => [
          evaluation.environment.slug,
          evaluation.source,
          sdkDescription(evaluation),
          utcMinute(evaluation.time),
        ]),
        options,
      );

export const showConfigActivity = async (
  context: CommandContext,
  [configKey]: readonly [string],
  options: ListingOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const receivedActivity = await client.getConfigActivity(project.id, configKey);
  if (receivedActivity === undefined) {
    throw new CliError(`No config in ${project.slug} has the key "${configKey}".`);
  }

  return {
    json: receivedActivity.responseBody,
    text: [...activityLines(configKey, receivedActivity.parsedBody, options), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
