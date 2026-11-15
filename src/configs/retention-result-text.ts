import type { Counting, VariationResult } from "../admin-api/experiment-runs.js";
import type { Retention } from "../admin-api/metrics.js";
import { formatCount } from "../format-count.js";
import { retentionDaysWords, retentionSpanOf, type RetentionSpan } from "../metrics/metric-label.js";
import { utcMinute } from "../utc-minute.js";
import type { RolloutComparison } from "./rollout-comparison.js";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export type RunTimes = { startedAt: string; endedAt: string | undefined };

export type RetentionOfTheRollout = {
  counting: Counting;
  runTimes: RunTimes;
  variations: VariationResult[];
  comparison: RolloutComparison;
};

type CountedFrom = { from: "run-start" } | { from: "attachment"; since: string };

const countedFromOf = (counting: Counting): CountedFrom => {
  switch (counting.kind) {
    case "whole-run":
    case "not-counted":
      return { from: "run-start" };
    case "since":
      return { from: "attachment", since: counting.since };
  }
};

type UnmeasuredContexts = { countedFrom: "run-start"; contexts: number } | { countedFrom: "attachment" };

type RetentionLine =
  | { state: "no-measured-contexts"; firstMeasuredAt: string; exposedContexts: number }
  | { state: "needs-more-exposures"; measuredContexts: number; exposedContexts: number }
  | { state: "ready"; measuredContexts: number; contextsStillToBeMeasured: UnmeasuredContexts }
  | {
      state: "ended-with-measured-contexts";
      measuredContexts: number;
      contextsNeverMeasured: UnmeasuredContexts;
    }
  | { state: "ended-without-measured-contexts"; contextsNeverMeasured: UnmeasuredContexts };

export const daysAContextWaitsToBeMeasured = (retention: Pick<Retention, "lastDay">): number =>
  retention.lastDay + 1;

const sumOf = (numbers: number[]): number => numbers.reduce((sum, number) => sum + number, 0);

const unmeasuredContextsOf = (countedFrom: CountedFrom, contexts: number): UnmeasuredContexts => {
  switch (countedFrom.from) {
    case "run-start":
      return { countedFrom: "run-start", contexts };
    case "attachment":
      return { countedFrom: "attachment" };
  }
};

const earliestExposureMeasuredOf = (
  runTimes: RunTimes,
  countedFrom: CountedFrom,
  firstDay: number,
): number => {
  const runStart = new Date(runTimes.startedAt).getTime();
  switch (countedFrom.from) {
    case "run-start":
      return runStart;
    case "attachment":
      return Math.max(runStart, new Date(countedFrom.since).getTime() - firstDay * DAY_IN_MILLISECONDS);
  }
};

const endedRunLineOf = (
  measuredContexts: number,
  contextsNeverMeasured: UnmeasuredContexts,
): RetentionLine =>
  measuredContexts === 0
    ? { state: "ended-without-measured-contexts", contextsNeverMeasured }
    : { state: "ended-with-measured-contexts", measuredContexts, contextsNeverMeasured };

const retentionLineOf = (
  retention: Retention,
  { counting, runTimes, variations, comparison }: RetentionOfTheRollout,
): RetentionLine => {
  const countedFrom = countedFromOf(counting);
  const measuredContexts = sumOf(variations.map((variation) => variation.exposures));
  const exposedContexts = sumOf(
    variations.map((variation) => variation.analyzedExposures ?? variation.exposures),
  );
  const unmeasuredContexts = unmeasuredContextsOf(countedFrom, exposedContexts - measuredContexts);
  if (runTimes.endedAt !== undefined) {
    return endedRunLineOf(measuredContexts, unmeasuredContexts);
  }
  if (measuredContexts === 0) {
    const firstMeasuredAt =
      earliestExposureMeasuredOf(runTimes, countedFrom, retention.firstDay) +
      daysAContextWaitsToBeMeasured(retention) * DAY_IN_MILLISECONDS;
    return {
      state: "no-measured-contexts",
      firstMeasuredAt: new Date(firstMeasuredAt).toISOString(),
      exposedContexts,
    };
  }
  if (comparison === "needs-more-exposures") {
    return { state: "needs-more-exposures", measuredContexts, exposedContexts };
  }
  return { state: "ready", measuredContexts, contextsStillToBeMeasured: unmeasuredContexts };
};

const showsTheNumbersWith = (line: RetentionLine): boolean => {
  switch (line.state) {
    case "no-measured-contexts":
    case "ended-without-measured-contexts":
      return false;
    case "needs-more-exposures":
    case "ready":
    case "ended-with-measured-contexts":
      return true;
  }
};

const PASSED: { [Span in RetentionSpan["span"]]: string } = {
  "one-day": "has passed",
  "several-days": "have passed",
};

const exposedSoFarWords = (exposedContexts: number): string =>
  exposedContexts === 1
    ? "1 context has been exposed so far."
    : `${formatCount(exposedContexts)} contexts have been exposed so far.`;

const measuredOfExposedWords = (measuredContexts: number, exposedContexts: number): string =>
  measuredContexts === 1
    ? `1 of the ${formatCount(exposedContexts)} contexts exposed has so far.`
    : `${formatCount(measuredContexts)} of the ${formatCount(exposedContexts)} contexts exposed have so far.`;

const stillToBeMeasuredWords = (unmeasured: UnmeasuredContexts, lastDay: number): string[] => {
  switch (unmeasured.countedFrom) {
    case "attachment":
      return [];
    case "run-start":
      return [
        unmeasured.contexts === 1
          ? `1 more has been exposed and is measured once its day ${lastDay} ends.`
          : `${formatCount(unmeasured.contexts)} more have been exposed and are measured once their day ${lastDay} ends.`,
      ];
  }
};

const neverMeasuredWords = (unmeasured: UnmeasuredContexts, waitDays: number): string[] => {
  switch (unmeasured.countedFrom) {
    case "attachment":
      return [];
    case "run-start":
      return [
        unmeasured.contexts === 1
          ? `The 1 context exposed in the run's last ${waitDays} days was never measured, since nothing after a run's end counts.`
          : `The ${formatCount(unmeasured.contexts)} contexts exposed in the run's last ${waitDays} days were never measured, since nothing after a run's end counts.`,
      ];
  }
};

const retentionLineWords = (retention: Retention, line: RetentionLine): string => {
  const days = retentionDaysWords(retention);
  const passed = PASSED[retentionSpanOf(retention).span];
  const waitDays = daysAContextWaitsToBeMeasured(retention);
  switch (line.state) {
    case "no-measured-contexts":
      return [
        `No context has had its ${days} yet.`,
        `A context is measured once its day ${retention.lastDay} has ended, ${waitDays} days after its exposure.`,
        `The first ones finish on ${utcMinute(line.firstMeasuredAt)}, and the numbers show from then on;`,
        "a lift shows once enough contexts of every variation are measured.",
        exposedSoFarWords(line.exposedContexts),
      ].join(" ");
    case "needs-more-exposures":
      return [
        `Retention needs more contexts that have had their ${days} before the variations can be compared.`,
        measuredOfExposedWords(line.measuredContexts, line.exposedContexts),
      ].join(" ");
    case "ready":
      return [
        `Measured over the ${formatCount(line.measuredContexts)} contexts whose ${days} ${passed}.`,
        ...stillToBeMeasuredWords(line.contextsStillToBeMeasured, retention.lastDay),
      ].join(" ");
    case "ended-with-measured-contexts":
      return [
        `Measured over the ${formatCount(line.measuredContexts)} contexts whose ${days} had passed when the run ended.`,
        ...neverMeasuredWords(line.contextsNeverMeasured, waitDays),
      ].join(" ");
    case "ended-without-measured-contexts":
      return [
        `No context's ${days} had passed when the run ended.`,
        ...neverMeasuredWords(line.contextsNeverMeasured, waitDays),
      ].join(" ");
  }
};

export type RetentionMeasurement = { line: string; showsTheNumbers: boolean };

export const retentionMeasurementOf = (
  retention: Retention,
  retentionOfTheRollout: RetentionOfTheRollout,
): RetentionMeasurement => {
  const retentionLine = retentionLineOf(retention, retentionOfTheRollout);
  return {
    line: retentionLineWords(retention, retentionLine),
    showsTheNumbers: showsTheNumbersWith(retentionLine),
  };
};
