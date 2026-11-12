import type { AdminApiClient, ParsedResponse, Project } from "../admin-api/AdminApiClient.js";
import type { Metric } from "../admin-api/metrics.js";
import { alignedColumns } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import { metricLabel } from "./metric-label.js";

type MetricSelection = { by: "event-name"; eventName: string } | { by: "id"; metricId: string };

export type MetricSelectionOptions = { id?: string };

export const metricSelectionOf = (
  eventName: string | undefined,
  options: MetricSelectionOptions,
): MetricSelection => {
  if (eventName !== undefined && options.id !== undefined) {
    throw new CliError("Name the metric by its event name or by its id with --id, not both.");
  }
  if (eventName !== undefined) {
    return { by: "event-name", eventName };
  }
  if (options.id !== undefined) {
    return { by: "id", metricId: options.id };
  }
  throw new CliError("Name the metric by its event name, or by its id with --id.");
};

export const noSelectedMetric = (project: Project, selection: MetricSelection): CliError => {
  switch (selection.by) {
    case "event-name":
      return new CliError(`No metric in ${project.slug} has the event name "${selection.eventName}".`);
    case "id":
      return new CliError(`No metric in ${project.slug} has the id "${selection.metricId}".`);
  }
};

const severalMetricsWithEventName = (project: Project, eventName: string, metrics: Metric[]): CliError =>
  new CliError(
    [
      `${metrics.length} metrics in ${project.slug} have the event name "${eventName}". Name one with --id:`,
      ...alignedColumns(metrics.map((metric) => [metric.id, metricLabel(metric)])).map((line) => `  ${line}`),
    ].join("\n"),
  );

const onlyMetricWithEventName = (
  project: Project,
  selection: MetricSelection & { by: "event-name" },
  metricsWithEventName: ParsedResponse<Metric>[],
): ParsedResponse<Metric> => {
  const [onlyMetric, ...otherMetrics] = metricsWithEventName;
  if (onlyMetric === undefined) {
    throw noSelectedMetric(project, selection);
  }
  if (otherMetrics.length > 0) {
    throw severalMetricsWithEventName(
      project,
      selection.eventName,
      metricsWithEventName.map((metric) => metric.parsedBody),
    );
  }
  return onlyMetric;
};

export const findSelectedMetric = async (
  client: AdminApiClient,
  project: Project,
  selection: MetricSelection,
): Promise<ParsedResponse<Metric>> => {
  switch (selection.by) {
    case "event-name":
      return onlyMetricWithEventName(
        project,
        selection,
        await client.listMetricsWithEventName(project.id, selection.eventName),
      );
    case "id": {
      const metric = await client.getMetric(project.id, selection.metricId);
      if (metric === undefined) {
        throw noSelectedMetric(project, selection);
      }
      return metric;
    }
  }
};
