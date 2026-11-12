import type { Metric, MetricUsage, OpenRuns } from "../admin-api/metrics.js";
import { metricLabel } from "./metric-label.js";
import { directionWords, kindWords, roleWords } from "./metric-words.js";

export const openRunEnvironmentNames = (
  openRuns: OpenRuns,
  environmentSlugs: ReadonlyMap<string, string>,
): string => openRuns.map((run) => environmentSlugs.get(run.environmentId) ?? run.environmentId).join(", ");

const usageLine = (usage: MetricUsage, environmentSlugs: ReadonlyMap<string, string>): string => {
  const primaryKind = usage.primaryKind === null ? "" : ` on ${kindWords(usage.primaryKind)}`;
  const runningIn =
    usage.openRuns.length === 0
      ? ""
      : `, running in ${openRunEnvironmentNames(usage.openRuns, environmentSlugs)}`;
  return `  ${usage.configKey}: ${roleWords(usage.role)}${primaryKind}${runningIn}`;
};

const usageLines = (metric: Metric, environmentSlugs: ReadonlyMap<string, string>): string[] =>
  metric.usages.length === 0
    ? ["No experiment uses it."]
    : ["Used by", ...metric.usages.map((usage) => usageLine(usage, environmentSlugs))];

export const metricText = (metric: Metric, environmentSlugs: ReadonlyMap<string, string>): string =>
  [
    metricLabel(metric),
    ...(metric.description === null ? [] : [`  Description: ${metric.description}`]),
    `  Kinds: ${metric.kinds.map(kindWords).join(", ")}`,
    `  Direction: ${directionWords(metric.direction)}`,
    "",
    ...usageLines(metric, environmentSlugs),
    "",
  ].join("\n");
