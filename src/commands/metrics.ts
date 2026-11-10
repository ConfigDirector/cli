import type { AdminApiClient, Project } from "../admin-api/AdminApiClient.js";
import type { DecidingExperiment, ExperimentWithOpenRuns, Metric } from "../admin-api/metrics.js";
import { alignedListing, type ListingOptions } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { environmentSlugsById } from "../environment-selection.js";
import { ExitCode } from "../ExitCode.js";
import { metricChangesOf, type UpdateMetricOptions } from "../metrics/metric-changes.js";
import { metricText, openRunEnvironmentNames } from "../metrics/metric-text.js";
import { directionWords, kindWords } from "../metrics/metric-words.js";
import { newMetricOf, type CreateMetricOptions } from "../metrics/new-metric.js";
import { plural } from "../plural.js";
import { connectToLinkedProject } from "../project-selection.js";

const usageDescription = (metric: Metric): string =>
  `used by ${metric.usages.length} ${plural(metric.usages.length, "experiment", "experiments")}`;

const METRIC_HEADER_ROW = ["EVENT NAME", "KINDS", "DIRECTION", "USED BY"];

const metricLines = (projectSlug: string, metrics: Metric[], options: ListingOptions): string[] =>
  metrics.length === 0
    ? [`No metrics found in ${projectSlug}.`]
    : alignedListing(
        METRIC_HEADER_ROW,
        metrics.map((metric) => [
          metric.eventName,
          metric.kinds.map(kindWords).join(", "),
          directionWords(metric.direction),
          usageDescription(metric),
        ]),
        options,
      );

export const listMetrics = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: ListingOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: metrics, responseBody } = await client.listMetrics(project.id);

  return {
    json: responseBody,
    text: [...metricLines(project.slug, metrics, options), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};

const openRunEnvironmentSlugsOf = async (
  client: AdminApiClient,
  project: Project,
  metric: Metric,
): Promise<ReadonlyMap<string, string>> =>
  metric.usages.some((usage) => usage.openRuns.length > 0)
    ? environmentSlugsById(client, project)
    : new Map();

const noMetricWithEventName = (project: Project, eventName: string): CliError =>
  new CliError(`No metric in ${project.slug} has the event name "${eventName}".`);

export const getMetric = async (
  context: CommandContext,
  [eventName]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const receivedMetric = await client.findMetricByEventName(project.id, eventName);
  if (receivedMetric === undefined) {
    throw noMetricWithEventName(project, eventName);
  }
  const { parsedBody: metric, responseBody } = receivedMetric;

  return {
    json: responseBody,
    text: metricText(metric, await openRunEnvironmentSlugsOf(client, project, metric)),
    exitCode: ExitCode.success,
  };
};

export const createMetric = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: CreateMetricOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: metric, responseBody } = await client.createMetric(project.id, newMetricOf(options));

  return {
    json: responseBody,
    text: [`Created metric ${metric.eventName} in ${project.slug}.`, metricText(metric, new Map())].join(
      "\n",
    ),
    exitCode: ExitCode.success,
  };
};

const kindInUseError = (eventName: string, experiments: DecidingExperiment[]): CliError =>
  new CliError(
    [
      `${experiments.length} ${plural(experiments.length, "experiment decides", "experiments decide")} on a kind ` +
        `this change removes, so ${eventName} was not updated:`,
      ...experiments.map(
        (experiment) => `  ${experiment.configKey} decides on ${kindWords(experiment.primaryKind)}`,
      ),
      `Give ${plural(experiments.length, "it", "each of them")} another primary kind first, ` +
        "on the experiment's Settings tab in the dashboard.",
    ].join("\n"),
  );

export const updateMetric = async (
  context: CommandContext,
  [eventName]: readonly [string],
  options: UpdateMetricOptions,
): Promise<CommandOutput> => {
  const changes = metricChangesOf(options);
  const { client, project } = await connectToLinkedProject(context);
  const currentMetric = await client.findMetricByEventName(project.id, eventName);
  if (currentMetric === undefined) {
    throw noMetricWithEventName(project, eventName);
  }
  const update = await client.updateMetric(project.id, currentMetric.parsedBody.id, changes);
  switch (update.outcome) {
    case "not-found":
      throw noMetricWithEventName(project, eventName);
    case "kind-in-use":
      throw kindInUseError(eventName, update.decidingExperiments);
    case "updated": {
      const { parsedBody: metric, responseBody } = update.metric;
      return {
        json: responseBody,
        text: [
          `Updated metric ${eventName} in ${project.slug}.`,
          metricText(metric, await openRunEnvironmentSlugsOf(client, project, metric)),
        ].join("\n"),
        exitCode: ExitCode.success,
      };
    }
  }
};

const experimentWithOpenRunsLine = (
  experiment: ExperimentWithOpenRuns,
  environmentSlugs: ReadonlyMap<string, string>,
): string =>
  `  ${experiment.configKey}, running in ${openRunEnvironmentNames(experiment.openRuns, environmentSlugs)}`;

const metricInUseError = (
  eventName: string,
  experiments: ExperimentWithOpenRuns[],
  environmentSlugs: ReadonlyMap<string, string>,
): CliError =>
  new CliError(
    [
      `${experiments.length} ${plural(experiments.length, "experiment", "experiments")} with a run in progress ` +
        `${plural(experiments.length, "uses", "use")} ${eventName}, so it was not deleted:`,
      ...experiments.map((experiment) => experimentWithOpenRunsLine(experiment, environmentSlugs)),
      "Ship or stop each run first, with configdirector configs ship or configs stop, " +
        "or detach the metric on the experiment's Settings tab in the dashboard.",
    ].join("\n"),
  );

export const deleteMetric = async (
  context: CommandContext,
  [eventName]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const currentMetric = await client.findMetricByEventName(project.id, eventName);
  if (currentMetric === undefined) {
    throw noMetricWithEventName(project, eventName);
  }
  const deletion = await client.deleteMetric(project.id, currentMetric.parsedBody.id);
  switch (deletion.outcome) {
    case "deleted":
      return {
        json: { deletedEventName: eventName },
        text: [`Deleted metric ${eventName} from ${project.slug}.`, ""].join("\n"),
        exitCode: ExitCode.success,
      };
    case "not-found":
      throw noMetricWithEventName(project, eventName);
    case "in-use":
      throw metricInUseError(
        eventName,
        deletion.experimentsWithOpenRuns,
        await environmentSlugsById(client, project),
      );
  }
};
