import type {
  ExperimentRun,
  MetricKindResult,
  MetricResult,
  Results,
  RolloutResults,
  RunLengthEstimate,
  VariationResult,
} from "../admin-api/experiment-runs.js";
import type { MetricDefinition, Retention } from "../admin-api/metrics.js";
import type { Variation } from "../admin-api/variations.js";
import { alignedColumns } from "../aligned-columns.js";
import { capitalized } from "../capitalized.js";
import { formatCount } from "../format-count.js";
import { eventNamesCountedBy, kindReportedAloneBy } from "../metrics/metric-definition.js";
import { metricLabel, retentionDaysWords } from "../metrics/metric-label.js";
import {
  directionWords,
  isMetricKind,
  kindWords,
  METRIC_ROLES,
  roleWords,
  type MetricKind,
} from "../metrics/metric-words.js";
import { plural } from "../plural.js";
import { describeVariationOrNoLongerListed } from "../rule-sentences.js";
import { utcMinute } from "../utc-minute.js";
import {
  daysAContextWaitsToBeMeasured,
  retentionMeasurementOf,
  type RetentionOfTheRollout,
  type RunTimes,
} from "./retention-result-text.js";
import { comparisonOf, type RolloutComparison } from "./rollout-comparison.js";

const VERDICT_WORDS: Readonly<Record<string, string>> = {
  "likely-better": "likely better",
  "likely-worse": "likely worse",
  "no-clear-difference": "no clear difference",
};

const formatAverage = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatShare = (value: number): string => `${(value * 100).toFixed(1)}%`;

const VALUE_FORMATS: { [Kind in MetricKind]: (value: number) => string } = {
  conversion: formatShare,
  "count-per-context": formatAverage,
  "value-per-context": formatAverage,
  ratio: formatAverage,
  funnel: formatShare,
  retention: formatShare,
};

const formatResultValue = (kind: string, value: number | undefined): string => {
  if (value === undefined) {
    return "-";
  }
  return isMetricKind(kind) ? VALUE_FORMATS[kind](value) : formatAverage(value);
};

const formatLift = (lift: number): string => {
  const wholePercent = Math.round(lift * 100);
  if (wholePercent > 0) {
    return `+${wholePercent.toLocaleString("en-US")}%`;
  }
  if (wholePercent < 0) {
    return `${wholePercent.toLocaleString("en-US")}%`;
  }
  return "0%";
};

const formatChance = (chance: number): string => {
  const wholePercent = Math.round(chance * 100);
  if (wholePercent < 1) {
    return "<1%";
  }
  if (wholePercent > 99) {
    return ">99%";
  }
  return `${wholePercent}%`;
};

const liftCell = (variation: VariationResult): string => {
  if (variation.lift === undefined) {
    return "-";
  }
  if (variation.interval === undefined) {
    return formatLift(variation.lift);
  }
  return `${formatLift(variation.lift)} (${formatLift(variation.interval.low)} to ${formatLift(variation.interval.high)})`;
};

const chanceCell = (chance: number | undefined, description: string): string =>
  chance === undefined ? "" : `${formatChance(chance)} ${description}`;

type ResultTable = {
  kind: string;
  controlVariationId: string;
  comparison: RolloutComparison;
  variations: Variation[];
  showsChanceToBeBest: boolean;
};

type CountsOfAVariation = { countsCells: string[]; hasNothingInItsDenominator: boolean };

const NO_COUNTS: CountsOfAVariation = { countsCells: [], hasNothingInItsDenominator: false };

const COUNTS_OF_A_VARIATION: { [Kind in MetricKind]: (variation: VariationResult) => CountsOfAVariation } = {
  conversion: () => NO_COUNTS,
  "count-per-context": () => NO_COUNTS,
  "value-per-context": () => NO_COUNTS,
  ratio: ({ numeratorTotal = 0, denominatorTotal = 0 }) => ({
    countsCells: [`${formatCount(numeratorTotal)} ÷ ${formatCount(denominatorTotal)}`],
    hasNothingInItsDenominator: denominatorTotal === 0,
  }),
  funnel: ({ contextsThatReachedEachStep = [] }) => ({
    countsCells: [`steps ${contextsThatReachedEachStep.map(formatCount).join(" → ")}`],
    hasNothingInItsDenominator: false,
  }),
  retention: ({ converters = 0, exposures }) => ({
    countsCells: [`${formatCount(converters)} of ${formatCount(exposures)} came back`],
    hasNothingInItsDenominator: false,
  }),
};

const countsOf = (kind: string, variation: VariationResult): CountsOfAVariation =>
  isMetricKind(kind) ? COUNTS_OF_A_VARIATION[kind](variation) : NO_COUNTS;

type ResultRowForm = "control" | "value-alone" | "compared" | "nothing-in-its-denominator";

const resultRowFormOf = (
  variation: VariationResult,
  counts: CountsOfAVariation,
  table: ResultTable,
): ResultRowForm => {
  if (table.comparison === "variations-compared" && counts.hasNothingInItsDenominator) {
    return "nothing-in-its-denominator";
  }
  if (variation.variationId === table.controlVariationId) {
    return "control";
  }
  return table.comparison === "needs-more-exposures" ? "value-alone" : "compared";
};

type ResultRow = { alignedCells: string[]; followedBy: string };

const NOTHING_IN_ITS_DENOMINATOR = "nothing added to its denominator yet, so it has no ratio to compare";

const resultRow = (variation: VariationResult, table: ResultTable): ResultRow => {
  const counts = countsOf(table.kind, variation);
  const nameValueAndCounts = [
    describeVariationOrNoLongerListed(variation.variationId, table.variations),
    formatResultValue(table.kind, variation.value),
    ...counts.countsCells,
  ];
  const chanceToBeBestCells = table.showsChanceToBeBest
    ? [chanceCell(variation.chanceToBeBest, "chance to be best")]
    : [];
  switch (resultRowFormOf(variation, counts, table)) {
    case "control":
      return { alignedCells: [...nameValueAndCounts, "control", "", ...chanceToBeBestCells], followedBy: "" };
    case "value-alone":
      return { alignedCells: nameValueAndCounts, followedBy: "" };
    case "nothing-in-its-denominator":
      return { alignedCells: [...nameValueAndCounts, ""], followedBy: NOTHING_IN_ITS_DENOMINATOR };
    case "compared":
      return {
        alignedCells: [
          ...nameValueAndCounts,
          liftCell(variation),
          chanceCell(variation.chanceToBeatControl, "chance to beat control"),
          ...chanceToBeBestCells,
          variation.verdict === undefined ? "" : (VERDICT_WORDS[variation.verdict] ?? variation.verdict),
        ],
        followedBy: "",
      };
  }
};

const resultRowLines = (rows: ResultRow[]): string[] =>
  alignedColumns(rows.map((row) => row.alignedCells)).map((line, index) =>
    `  ${line}${rows[index]?.followedBy ?? ""}`.trimEnd(),
  );

const DAYS_IN_A_YEAR = 365;

type ContextMeasurement =
  { measured: "as-their-events-arrive" } | { measured: "once-their-days-have-passed"; retention: Retention };

const contextMeasurementOf = (definition: MetricDefinition): ContextMeasurement => {
  switch (definition.definedBy) {
    case "event-name":
    case "ratio":
    case "funnel":
      return { measured: "as-their-events-arrive" };
    case "retention":
      return { measured: "once-their-days-have-passed", retention: definition.retention };
  }
};

type LiftRowForm =
  | { form: "days-remaining"; days: number }
  | { form: "waiting-to-be-measured"; days: number }
  | { form: "more-than-a-year" }
  | { form: "enough-exposures" }
  | { form: "enough-contexts-measured" }
  | { form: "no-pace" };

const isOnlyTheWaitToBeMeasured = (
  daysRemaining: number,
  contextMeasurement: ContextMeasurement,
): boolean => {
  switch (contextMeasurement.measured) {
    case "as-their-events-arrive":
      return false;
    case "once-their-days-have-passed":
      return daysRemaining === daysAContextWaitsToBeMeasured(contextMeasurement.retention);
  }
};

const ENOUGH_FORM: { [Measured in ContextMeasurement["measured"]]: LiftRowForm } = {
  "as-their-events-arrive": { form: "enough-exposures" },
  "once-their-days-have-passed": { form: "enough-contexts-measured" },
};

const liftRowFormOf = (
  daysRemaining: number | undefined,
  contextMeasurement: ContextMeasurement,
): LiftRowForm => {
  if (daysRemaining === undefined) {
    return { form: "no-pace" };
  }
  if (daysRemaining === 0) {
    return ENOUGH_FORM[contextMeasurement.measured];
  }
  if (isOnlyTheWaitToBeMeasured(daysRemaining, contextMeasurement)) {
    return { form: "waiting-to-be-measured", days: daysRemaining };
  }
  return daysRemaining > DAYS_IN_A_YEAR
    ? { form: "more-than-a-year" }
    : { form: "days-remaining", days: daysRemaining };
};

const daysRemainingCells = (liftRow: LiftRowForm): string[] => {
  switch (liftRow.form) {
    case "days-remaining":
      return [`about ${formatCount(liftRow.days)} ${plural(liftRow.days, "day", "days")} remaining`];
    case "waiting-to-be-measured":
      return [`up to ${formatCount(liftRow.days)} days remaining`];
    case "more-than-a-year":
      return ["more than a year remaining"];
    case "enough-exposures":
      return ["enough exposures"];
    case "enough-contexts-measured":
      return ["enough contexts measured"];
    case "no-pace":
      return [];
  }
};

const daysTheEstimateIncludesLines = (contextMeasurement: ContextMeasurement): string[] => {
  switch (contextMeasurement.measured) {
    case "as-their-events-arrive":
      return [];
    case "once-their-days-have-passed": {
      const { retention } = contextMeasurement;
      return [
        `Every number of days includes ${daysAContextWaitsToBeMeasured(retention)} days for the last contexts exposed ` +
          `to have their ${retentionDaysWords(retention)}, since a context is measured only once its day ` +
          `${retention.lastDay} has ended.`,
      ];
    }
  }
};

type ExposurePace = { form: "new-exposures"; exposuresPerDay: number } | { form: "no-new-exposures" };

const exposurePaceOf = (estimate: RunLengthEstimate): ExposurePace =>
  estimate.exposuresPerDay > 0
    ? { form: "new-exposures", exposuresPerDay: Math.round(estimate.exposuresPerDay) }
    : { form: "no-new-exposures" };

const paceLine = (estimate: RunLengthEstimate): string => {
  const since = utcMinute(estimate.paceMeasuredSince);
  const pace = exposurePaceOf(estimate);
  switch (pace.form) {
    case "new-exposures":
      return `How long to run, at the pace since ${since}: about ${formatCount(pace.exposuresPerDay)} ${plural(pace.exposuresPerDay, "new exposure", "new exposures")} a day`;
    case "no-new-exposures":
      return `How long to run: no new contexts were exposed since ${since}, so the days cannot be estimated.`;
  }
};

const runLengthEstimateLines = (
  estimate: RunLengthEstimate | undefined,
  contextMeasurement: ContextMeasurement,
): string[] => {
  if (estimate === undefined) {
    return [];
  }
  return [
    paceLine(estimate),
    ...alignedColumns(
      estimate.lifts.map((liftEstimate) => [
        `For a real lift of ${formatLift(liftEstimate.lift)}`,
        `${formatCount(estimate.analyzedExposures)} of about ${formatCount(liftEstimate.exposuresNeeded)} exposures`,
        ...daysRemainingCells(liftRowFormOf(liftEstimate.daysRemaining, contextMeasurement)),
      ]),
    ).map((line) => `  ${line}`),
    "A row's lift is one a variation might really have over the control, not the lift measured so far: the smaller it is, the longer the run.",
    ...daysTheEstimateIncludesLines(contextMeasurement),
    "Whatever the estimate says, a run should cover at least one full week, so every day of the week is in the result.",
  ];
};

const roleAndMetric = (role: string, metric: MetricResult): string =>
  `${capitalized(roleWords(role))}: ${metricLabel(metric)}`;

const kindHeading = (role: string, metric: MetricResult, kind: string): string =>
  kindReportedAloneBy(metric) === undefined
    ? `${roleAndMetric(role, metric)}, ${kindWords(kind)}, ${directionWords(metric.direction)}`
    : `${roleAndMetric(role, metric)}, ${directionWords(metric.direction)}`;

type MeasurementLines = { lines: string[]; showsTheNumbers: boolean };

const measurementLinesOf = (
  contextMeasurement: ContextMeasurement,
  retentionOfTheRollout: RetentionOfTheRollout,
): MeasurementLines => {
  switch (contextMeasurement.measured) {
    case "as-their-events-arrive":
      return { lines: [], showsTheNumbers: true };
    case "once-their-days-have-passed": {
      const { line, showsTheNumbers } = retentionMeasurementOf(
        contextMeasurement.retention,
        retentionOfTheRollout,
      );
      return { lines: [`  ${line}`], showsTheNumbers };
    }
  }
};

type MetricOfTheRollout = {
  role: string;
  metric: MetricResult;
  rollout: RolloutResults;
  variations: Variation[];
  runTimes: RunTimes;
};

const kindResultLines = (
  { role, metric, rollout, variations, runTimes }: MetricOfTheRollout,
  kindResult: MetricKindResult,
  countingLines: string[],
): string[] => {
  const kindResultOfRollout = kindResult.rollouts.find((candidate) => candidate.ruleId === rollout.ruleId);
  if (kindResultOfRollout === undefined) {
    return [];
  }
  const variationResults = kindResultOfRollout.variations;
  const comparison = comparisonOf(kindResultOfRollout.state ?? rollout.state);
  const table: ResultTable = {
    kind: kindResult.kind,
    controlVariationId: rollout.controlVariationId,
    comparison,
    variations,
    showsChanceToBeBest: variationResults.some((variation) => variation.chanceToBeBest !== undefined),
  };
  const contextMeasurement = contextMeasurementOf(metric.definition);
  const measurement = measurementLinesOf(contextMeasurement, {
    counting: metric.counting,
    runTimes,
    variations: variationResults,
    comparison,
  });
  return [
    kindHeading(role, metric, kindResult.kind),
    ...countingLines,
    ...measurement.lines,
    ...(measurement.showsTheNumbers
      ? resultRowLines(variationResults.map((variation) => resultRow(variation, table)))
      : []),
    ...runLengthEstimateLines(kindResultOfRollout.runLengthEstimate, contextMeasurement),
  ];
};

const METRIC_COUNTED_FROM_ITS_ATTACHMENT: { [DefinedBy in MetricDefinition["definedBy"]]: string } = {
  "event-name": "a metric with a filter or a value field",
  ratio: "a ratio",
  funnel: "a funnel",
  retention: "a retention metric",
};

const notCountedLine = (metric: MetricResult): string =>
  `  This run did not count this metric: ${METRIC_COUNTED_FROM_ITS_ATTACHMENT[metric.definition.definedBy]} ` +
  "is counted from the moment it is attached to an experiment, and this one was not attached while the run was open.";

const countedSinceLine = (metric: MetricResult, since: string): string => {
  const attachedSince = `  Counted since ${utcMinute(since)}, when this metric was attached to the experiment.`;
  const contextMeasurement = contextMeasurementOf(metric.definition);
  switch (contextMeasurement.measured) {
    case "as-their-events-arrive":
      return `${attachedSince} Events reported before then are not in these numbers.`;
    case "once-their-days-have-passed":
      return (
        `${attachedSince} Only the contexts whose day ${contextMeasurement.retention.firstDay} ` +
        "started after then are measured."
      );
  }
};

const metricResultLines = (metricOfTheRollout: MetricOfTheRollout): string[] => {
  const { role, metric } = metricOfTheRollout;
  const kindResultsWith = (countingLines: string[]): string[] =>
    metric.kinds.flatMap((kindResult) => kindResultLines(metricOfTheRollout, kindResult, countingLines));
  const { counting } = metric;
  switch (counting.kind) {
    case "whole-run":
      return kindResultsWith([]);
    case "since":
      return kindResultsWith([countedSinceLine(metric, counting.since)]);
    case "not-counted":
      return [`${roleAndMetric(role, metric)}, ${directionWords(metric.direction)}`, notCountedLine(metric)];
  }
};

const crossoverLines = (crossovers: number): string[] => {
  if (crossovers === 0) {
    return [];
  }
  return [
    crossovers === 1
      ? "1 context was exposed to more than one variation and is left out of every metric."
      : `${crossovers} contexts were exposed to more than one variation and are left out of every metric.`,
  ];
};

const comparisonLines = (comparison: RolloutComparison): string[] => {
  switch (comparison) {
    case "variations-compared":
      return [];
    case "needs-more-exposures":
      return ["The run needs more exposures before the variations can be compared."];
  }
};

export type RunResults = { form: "no-metrics" } | { form: "measured"; results: Results; runTimes: RunTimes };

export const runResultsOf = (run: ExperimentRun): RunResults =>
  METRIC_ROLES.some((role) => run.results[role].length > 0)
    ? { form: "measured", results: run.results, runTimes: { startedAt: run.startedAt, endedAt: run.endedAt } }
    : { form: "no-metrics" };

export const rolloutResultLines = (
  runResults: RunResults,
  ruleId: string,
  variations: Variation[],
): string[] => {
  switch (runResults.form) {
    case "no-metrics":
      return [];
    case "measured": {
      const { results, runTimes } = runResults;
      const rollout = results.rollouts.find((candidate) => candidate.ruleId === ruleId);
      if (rollout === undefined) {
        return [];
      }
      return [
        ...comparisonLines(comparisonOf(rollout.state)),
        ...crossoverLines(rollout.crossovers),
        ...METRIC_ROLES.flatMap((role) =>
          results[role].flatMap((metric) =>
            metricResultLines({ role, metric, rollout, variations, runTimes }),
          ),
        ),
      ];
    }
  }
};

const measuredEventNamesOf = (runResults: RunResults): ReadonlySet<string> => {
  switch (runResults.form) {
    case "no-metrics":
      return new Set();
    case "measured":
      return new Set(METRIC_ROLES.flatMap((role) => runResults.results[role].flatMap(eventNamesCountedBy)));
  }
};

export const eventsWithoutAMetricLines = (run: ExperimentRun, runResults: RunResults): string[] => {
  const measuredEventNames = measuredEventNamesOf(runResults);
  const events = run.trackedEvents.events.filter((event) => !measuredEventNames.has(event.name));
  if (events.length === 0) {
    return [];
  }
  const eventDescriptions = events.map(
    (event) => `${event.name} (${event.contexts} ${plural(event.contexts, "context", "contexts")})`,
  );
  return [`Events with no metric: ${eventDescriptions.join(", ")}`];
};

type ResultsFreshness =
  | { form: "no-results" }
  | { form: "running" }
  | { form: "final"; asOf: string }
  | { form: "ended-before-final-results" };

const decideResultsFreshness = (run: ExperimentRun, runResults: RunResults): ResultsFreshness => {
  if (runResults.form === "no-metrics") {
    return { form: "no-results" };
  }
  if (run.endedAt === undefined) {
    return { form: "running" };
  }
  if (runResults.results.asOf === undefined) {
    return { form: "ended-before-final-results" };
  }
  return { form: "final", asOf: runResults.results.asOf };
};

export const resultsFreshnessLines = (run: ExperimentRun, runResults: RunResults): string[] => {
  const freshness = decideResultsFreshness(run, runResults);
  switch (freshness.form) {
    case "no-results":
      return [];
    case "running":
      return ["Results can be up to 25 minutes behind."];
    case "final":
      return [`Final results, as of ${utcMinute(freshness.asOf)}, when the run ended.`];
    case "ended-before-final-results":
      return [];
  }
};
