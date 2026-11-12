import type { AdminApiClient, Project } from "../admin-api/AdminApiClient.js";
import type { DecidingExperiment, ExperimentWithOpenRuns, Metric } from "../admin-api/metrics.js";
import { alignedListing, type ListingOptions } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { environmentSlugsById } from "../environment-selection.js";
import { ExitCode } from "../ExitCode.js";
import { metricChangesOf, type UpdateMetricOptions } from "../metrics/metric-changes.js";
import { metricLabel } from "../metrics/metric-label.js";
import {
  findSelectedMetric,
  metricSelectionOf,
  noSelectedMetric,
  type MetricSelectionOptions,
} from "../metrics/metric-selection.js";
import { metricText, openRunEnvironmentNames } from "../metrics/metric-text.js";
import { directionWords, kindWords } from "../metrics/metric-words.js";
import { newMetricOf, type CreateMetricOptions } from "../metrics/new-metric.js";
import { plural } from "../plural.js";
import { connectToLinkedProject } from "../project-selection.js";

const usageDescription = (metric: Metric): string =>
  `used by ${metric.usages.length} ${plural(metric.usages.length, "experiment", "experiments")}`;

const METRIC_HEADER_ROW = ["METRIC", "KINDS", "DIRECTION", "USED BY"];

const metricLines = (projectSlug: string, metrics: Metric[], options: ListingOptions): string[] =>
  metrics.length === 0
    ? [`No metrics found in ${projectSlug}.`]
    : alignedListing(
        METRIC_HEADER_ROW,
        metrics.map((metric) => [
          metricLabel(metric),
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

export const getMetric = async (
  context: CommandContext,
  [eventName]: readonly [string | undefined],
  options: MetricSelectionOptions,
): Promise<CommandOutput> => {
  const selection = metricSelectionOf(eventName, options);
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: metric, responseBody } = await findSelectedMetric(client, project, selection);

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
  const newMetric = await newMetricOf(options, context.invocation);
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: metric, responseBody } = await client.createMetric(project.id, newMetric);

  return {
    json: responseBody,
    text: [`Created metric ${metricLabel(metric)} in ${project.slug}.`, metricText(metric, new Map())].join(
      "\n",
    ),
    exitCode: ExitCode.success,
  };
};

const kindInUseError = (metric: Metric, experiments: DecidingExperiment[]): CliError =>
  new CliError(
    [
      `${experiments.length} ${plural(experiments.length, "experiment decides", "experiments decide")} on a kind ` +
        `this change removes, so ${metricLabel(metric)} was not updated:`,
      ...experiments.map(
        (experiment) => `  ${experiment.configKey} decides on ${kindWords(experiment.primaryKind)}`,
      ),
      `Give ${plural(experiments.length, "it", "each of them")} another primary kind first, ` +
        "on the experiment's Settings tab in the dashboard.",
    ].join("\n"),
  );

export const updateMetric = async (
  context: CommandContext,
  [eventName]: readonly [string | undefined],
  options: UpdateMetricOptions & MetricSelectionOptions,
): Promise<CommandOutput> => {
  const selection = metricSelectionOf(eventName, options);
  const changes = metricChangesOf(options);
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: currentMetric } = await findSelectedMetric(client, project, selection);
  const update = await client.updateMetric(project.id, currentMetric.id, changes);
  switch (update.outcome) {
    case "not-found":
      throw noSelectedMetric(project, selection);
    case "kind-in-use":
      throw kindInUseError(currentMetric, update.decidingExperiments);
    case "updated": {
      const { parsedBody: metric, responseBody } = update.metric;
      return {
        json: responseBody,
        text: [
          `Updated metric ${metricLabel(metric)} in ${project.slug}.`,
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
  metric: Metric,
  experiments: ExperimentWithOpenRuns[],
  environmentSlugs: ReadonlyMap<string, string>,
): CliError =>
  new CliError(
    [
      `${experiments.length} ${plural(experiments.length, "experiment", "experiments")} with a run in progress ` +
        `${plural(experiments.length, "uses", "use")} ${metricLabel(metric)}, so it was not deleted:`,
      ...experiments.map((experiment) => experimentWithOpenRunsLine(experiment, environmentSlugs)),
      "Ship or stop each run first, with configdirector configs ship or configs stop, " +
        "or detach the metric on the experiment's Settings tab in the dashboard.",
    ].join("\n"),
  );

export const deleteMetric = async (
  context: CommandContext,
  [eventName]: readonly [string | undefined],
  options: MetricSelectionOptions,
): Promise<CommandOutput> => {
  const selection = metricSelectionOf(eventName, options);
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: metric } = await findSelectedMetric(client, project, selection);
  const deletion = await client.deleteMetric(project.id, metric.id);
  switch (deletion.outcome) {
    case "deleted":
      return {
        json: { deletedMetricId: metric.id, deletedEventName: metric.eventName },
        text: [`Deleted metric ${metricLabel(metric)} from ${project.slug}.`, ""].join("\n"),
        exitCode: ExitCode.success,
      };
    case "not-found":
      throw noSelectedMetric(project, selection);
    case "in-use":
      throw metricInUseError(
        metric,
        deletion.experimentsWithOpenRuns,
        await environmentSlugsById(client, project),
      );
  }
};
