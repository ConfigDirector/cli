import type { Environment } from "../admin-api/AdminApiClient.js";
import type { ConfigWithTargetingRules } from "../admin-api/config-with-targeting-rules.js";
import type { ExperimentRun, RolloutExposures } from "../admin-api/experiment-runs.js";
import type { Variation } from "../admin-api/variations.js";
import { alignedColumns } from "../aligned-columns.js";
import { oldKeyLines } from "../old-key-lines.js";
import { plural } from "../plural.js";
import { describeVariation, formatPercentage, type SegmentsById } from "../rule-sentences.js";
import { utcMinute } from "../utc-minute.js";
import { environmentLabel, targetingRuleLines } from "./config-text.js";

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  shipped: "Shipped",
  stopped: "Stopped",
  replaced: "Replaced",
};

const VERDICT_SENTENCES: Readonly<Record<string, string>> = {
  matches: "The split matches the configured shares.",
  mismatch:
    "The split does not match the configured shares. This usually means some contexts evaluate without " +
    "a stable identifier, or a rule above the split catches part of the traffic. Results from this run are not reliable.",
  "needs-more-exposures":
    "The run needs more exposures before the split can be checked against the configured shares.",
};

const variationDescription = (variationId: string, variations: Variation[]): string | undefined => {
  const variation = variations.find((candidate) => candidate.id === variationId);
  return variation && describeVariation(variation);
};

const runHeadline = (run: ExperimentRun, variations: Variation[]): string => {
  if (run.outcome === undefined || run.endedAt === undefined) {
    return `Running since ${utcMinute(run.startedAt)}`;
  }
  const outcomeLabel = OUTCOME_LABELS[run.outcome] ?? run.outcome;
  const shippedVariation = run.shippedVariationId && variationDescription(run.shippedVariationId, variations);
  const outcome = shippedVariation ? `${outcomeLabel} ${shippedVariation}` : outcomeLabel;
  return `${outcome}, ${utcMinute(run.startedAt)} to ${utcMinute(run.endedAt)}`;
};

const rolloutAudience = (run: ExperimentRun, rollout: RolloutExposures): string =>
  run.rollouts.find((candidate) => candidate.ruleId === rollout.ruleId)?.conditions ??
  "everyone not caught by a rule above";

const rolloutSummary = (rollout: RolloutExposures): string =>
  `${rollout.exposures} ${plural(rollout.exposures, "context exposed", "contexts exposed")}, ` +
  `${rollout.evaluations} ${plural(rollout.evaluations, "evaluation", "evaluations")}. ` +
  (VERDICT_SENTENCES[rollout.verdict] ?? rollout.verdict);

const rolloutLines = (run: ExperimentRun, rollout: RolloutExposures, variations: Variation[]): string[] => [
  `Rollout: ${rolloutAudience(run, rollout)}`,
  ...alignedColumns(
    rollout.variations.map((variation) => [
      variationDescription(variation.variationId, variations) ?? "a variation no longer listed",
      `${variation.exposures} ${plural(variation.exposures, "exposure", "exposures")}`,
      `configured ${formatPercentage(variation.percentage)}%`,
    ]),
  ).map((line) => `  ${line}`),
  `  ${rolloutSummary(rollout)}`,
];

const uncountedEvaluationsLines = (evaluations: number, one: string, several: string): string[] => {
  if (evaluations === 0) {
    return [];
  }
  return [evaluations === 1 ? `1 evaluation ${one}` : `${evaluations} evaluations ${several}`];
};

const runLines = (run: ExperimentRun, variations: Variation[]): string[] => [
  runHeadline(run, variations),
  ...[
    ...run.exposures.rollouts.flatMap((rollout) => rolloutLines(run, rollout, variations)),
    ...uncountedEvaluationsLines(
      run.exposures.evaluationsFromSdksNotReportingExposures,
      "came from an SDK version that does not report exposures yet. It is not counted above; update that SDK to count it.",
      "came from SDK versions that do not report exposures yet. They are not counted above; update those SDKs to count them.",
    ),
    ...uncountedEvaluationsLines(
      run.exposures.evaluationsWithoutIdentifier,
      "came from an anonymous context, so it is not an exposure. In a server SDK, a context without an identifier skips the split and is served the default targeting rule value; any other anonymous context sees its share of the split without being stored.",
      "came from anonymous contexts, so they are not exposures. In a server SDK, a context without an identifier skips the split and is served the default targeting rule value; any other anonymous context sees its share of the split without being stored.",
    ),
  ].map((line) => `  ${line}`),
];

export const runsText = (
  config: ConfigWithTargetingRules,
  requestedKey: string,
  environment: Environment,
  runs: ExperimentRun[],
): string => {
  const environmentName = environmentLabel(environment);
  return [
    ...oldKeyLines(requestedKey, config.key),
    ...(runs.length === 0
      ? [`No runs of ${config.key} in ${environmentName}.`]
      : [
          `Runs of ${config.key} in ${environmentName}, newest first:`,
          ...runs.flatMap((run) => ["", ...runLines(run, config.variations)]),
        ]),
    "",
  ].join("\n");
};

type SavedRules = {
  config: ConfigWithTargetingRules;
  requestedKey: string;
  environment: Environment;
  segments: SegmentsById;
};

const savedRulesText = (
  { config, requestedKey, environment, segments }: SavedRules,
  headline: string,
): string =>
  [
    ...oldKeyLines(requestedKey, config.key),
    headline,
    "",
    ...config.targets
      .filter((targetingRules) => targetingRules.environment.slug === environment.slug)
      .flatMap((targetingRules) => targetingRuleLines(targetingRules, segments, config.variations)),
    "",
  ].join("\n");

export const shippedVariationText = (savedRules: SavedRules, variation: Variation): string =>
  savedRulesText(
    savedRules,
    `Shipped ${describeVariation(variation)} in ${environmentLabel(savedRules.environment)}.`,
  );

export const stoppedRunText = (savedRules: SavedRules): string =>
  savedRulesText(
    savedRules,
    `Stopped the run of ${savedRules.config.key} in ${environmentLabel(savedRules.environment)}.`,
  );
