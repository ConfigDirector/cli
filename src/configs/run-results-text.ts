import type {
  ExperimentRun,
  MetricKindResult,
  MetricResult,
  Results,
  RolloutResults,
  RunLengthEstimate,
  VariationResult,
} from "../admin-api/experiment-runs.js";
import type { Variation } from "../admin-api/variations.js";
import { alignedColumns } from "../aligned-columns.js";
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

const VERDICT_WORDS: Readonly<Record<string, string>> = {
  "likely-better": "likely better",
  "likely-worse": "likely worse",
  "no-clear-difference": "no clear difference",
};

const formatAverage = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const VALUE_FORMATS: { [Kind in MetricKind]: (value: number) => string } = {
  conversion: (value) => `${(value * 100).toFixed(1)}%`,
  "count-per-context": formatAverage,
  "value-per-context": formatAverage,
};

const formatResultValue = (kind: string, value: number): string =>
  isMetricKind(kind) ? VALUE_FORMATS[kind](value) : formatAverage(value);

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

type RolloutComparison = "variations-compared" | "needs-more-exposures";

const comparisonOf = (rollout: RolloutResults): RolloutComparison =>
  rollout.state === "needs-more-exposures" ? "needs-more-exposures" : "variations-compared";

type ResultTable = {
  kind: string;
  controlVariationId: string;
  comparison: RolloutComparison;
  variations: Variation[];
  showsChanceToBeBest: boolean;
};

type ResultRowForm = "control" | "value-alone" | "compared";

const resultRowFormOf = (variation: VariationResult, table: ResultTable): ResultRowForm => {
  if (variation.variationId === table.controlVariationId) {
    return "control";
  }
  return table.comparison === "needs-more-exposures" ? "value-alone" : "compared";
};

const resultRow = (variation: VariationResult, table: ResultTable): string[] => {
  const nameAndValue = [
    describeVariationOrNoLongerListed(variation.variationId, table.variations),
    formatResultValue(table.kind, variation.value),
  ];
  const chanceToBeBestCells = table.showsChanceToBeBest
    ? [chanceCell(variation.chanceToBeBest, "chance to be best")]
    : [];
  switch (resultRowFormOf(variation, table)) {
    case "control":
      return [...nameAndValue, "control", "", ...chanceToBeBestCells];
    case "value-alone":
      return nameAndValue;
    case "compared":
      return [
        ...nameAndValue,
        liftCell(variation),
        chanceCell(variation.chanceToBeatControl, "chance to beat control"),
        ...chanceToBeBestCells,
        variation.verdict === undefined ? "" : (VERDICT_WORDS[variation.verdict] ?? variation.verdict),
      ];
  }
};

const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const DAYS_IN_A_YEAR = 365;

const formatCount = (count: number): string => count.toLocaleString("en-US");

type LiftRowForm =
  | { form: "days-remaining"; days: number }
  | { form: "more-than-a-year" }
  | { form: "enough-exposures" }
  | { form: "no-pace" };

const liftRowFormOf = (daysRemaining: number | undefined): LiftRowForm => {
  if (daysRemaining === undefined) {
    return { form: "no-pace" };
  }
  if (daysRemaining === 0) {
    return { form: "enough-exposures" };
  }
  return daysRemaining > DAYS_IN_A_YEAR
    ? { form: "more-than-a-year" }
    : { form: "days-remaining", days: daysRemaining };
};

const daysRemainingCells = (liftRow: LiftRowForm): string[] => {
  switch (liftRow.form) {
    case "days-remaining":
      return [`about ${formatCount(liftRow.days)} ${plural(liftRow.days, "day", "days")} remaining`];
    case "more-than-a-year":
      return ["more than a year remaining"];
    case "enough-exposures":
      return ["enough exposures"];
    case "no-pace":
      return [];
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

const runLengthEstimateLines = (estimate: RunLengthEstimate | undefined): string[] => {
  if (estimate === undefined) {
    return [];
  }
  return [
    paceLine(estimate),
    ...alignedColumns(
      estimate.lifts.map((liftEstimate) => [
        `For a real lift of ${formatLift(liftEstimate.lift)}`,
        `${formatCount(estimate.analyzedExposures)} of about ${formatCount(liftEstimate.exposuresNeeded)} exposures`,
        ...daysRemainingCells(liftRowFormOf(liftEstimate.daysRemaining)),
      ]),
    ).map((line) => `  ${line}`),
    "A row's lift is one a variation might really have over the control, not the lift measured so far: the smaller it is, the longer the run.",
    "Whatever the estimate says, a run should cover at least one full week, so every day of the week is in the result.",
  ];
};

const kindResultLines = (
  role: string,
  metric: MetricResult,
  kindResult: MetricKindResult,
  rollout: RolloutResults,
  variations: Variation[],
): string[] => {
  const kindResultOfRollout = kindResult.rollouts.find((candidate) => candidate.ruleId === rollout.ruleId);
  if (kindResultOfRollout === undefined) {
    return [];
  }
  const variationResults = kindResultOfRollout.variations;
  const table: ResultTable = {
    kind: kindResult.kind,
    controlVariationId: rollout.controlVariationId,
    comparison: comparisonOf(rollout),
    variations,
    showsChanceToBeBest: variationResults.some((variation) => variation.chanceToBeBest !== undefined),
  };
  return [
    `${capitalized(roleWords(role))}: ${metric.eventName}, ${kindWords(kindResult.kind)}, ${directionWords(metric.direction)}`,
    ...alignedColumns(variationResults.map((variation) => resultRow(variation, table))).map((line) =>
      `  ${line}`.trimEnd(),
    ),
    ...runLengthEstimateLines(kindResultOfRollout.runLengthEstimate),
  ];
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

export type RunResults = { form: "no-metrics" } | { form: "measured"; results: Results };

export const runResultsOf = (run: ExperimentRun): RunResults =>
  METRIC_ROLES.some((role) => run.results[role].length > 0)
    ? { form: "measured", results: run.results }
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
      const { results } = runResults;
      const rollout = results.rollouts.find((candidate) => candidate.ruleId === ruleId);
      if (rollout === undefined) {
        return [];
      }
      return [
        ...comparisonLines(comparisonOf(rollout)),
        ...crossoverLines(rollout.crossovers),
        ...METRIC_ROLES.flatMap((role) =>
          results[role].flatMap((metric) =>
            metric.kinds.flatMap((kindResult) =>
              kindResultLines(role, metric, kindResult, rollout, variations),
            ),
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
      return new Set(
        METRIC_ROLES.flatMap((role) => runResults.results[role].map((metric) => metric.eventName)),
      );
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
