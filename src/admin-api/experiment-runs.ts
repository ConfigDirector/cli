import * as v from "valibot";

const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

const RolloutExposuresSchema = v.object({
  ruleId: v.string(),
  exposures: v.number(),
  evaluations: v.number(),
  verdict: v.string(),
  variations: v.array(v.object({ variationId: v.string(), percentage: v.number(), exposures: v.number() })),
});

export type RolloutExposures = v.InferOutput<typeof RolloutExposuresSchema>;

const VariationResultSchema = v.object({
  variationId: v.string(),
  value: v.number(),
  lift: v.optional(v.number()),
  interval: v.optional(v.object({ low: v.number(), high: v.number() })),
  chanceToBeatControl: v.optional(v.number()),
  chanceToBeBest: v.optional(v.number()),
  verdict: v.optional(v.string()),
});

export type VariationResult = v.InferOutput<typeof VariationResultSchema>;

const RunLengthEstimateSchema = v.object({
  analyzedExposures: v.number(),
  exposuresPerDay: v.number(),
  paceMeasuredSince: TimestampSchema,
  lifts: v.array(
    v.object({ lift: v.number(), exposuresNeeded: v.number(), daysRemaining: v.optional(v.number()) }),
  ),
});

export type RunLengthEstimate = v.InferOutput<typeof RunLengthEstimateSchema>;

const MetricKindResultSchema = v.object({
  kind: v.string(),
  rollouts: v.array(
    v.object({
      ruleId: v.string(),
      variations: v.array(VariationResultSchema),
      runLengthEstimate: v.optional(RunLengthEstimateSchema),
    }),
  ),
});

export type MetricKindResult = v.InferOutput<typeof MetricKindResultSchema>;

const MetricResultSchema = v.object({
  eventName: v.string(),
  direction: v.string(),
  kinds: v.array(MetricKindResultSchema),
});

export type MetricResult = v.InferOutput<typeof MetricResultSchema>;

const RolloutResultsSchema = v.object({
  ruleId: v.string(),
  controlVariationId: v.string(),
  state: v.string(),
  crossovers: v.number(),
});

export type RolloutResults = v.InferOutput<typeof RolloutResultsSchema>;

const ResultsSchema = v.object({
  asOf: v.optional(TimestampSchema),
  rollouts: v.array(RolloutResultsSchema),
  primary: v.array(MetricResultSchema),
  secondary: v.array(MetricResultSchema),
  guardrail: v.array(MetricResultSchema),
});

export type Results = v.InferOutput<typeof ResultsSchema>;

const ExperimentRunSchema = v.object({
  startedAt: TimestampSchema,
  endedAt: v.optional(TimestampSchema),
  outcome: v.optional(v.string()),
  shippedVariationId: v.optional(v.string()),
  hypothesis: v.optional(v.string()),
  note: v.optional(v.string()),
  rollouts: v.array(v.object({ ruleId: v.string(), conditions: v.optional(v.string()) })),
  exposures: v.object({
    rollouts: v.array(RolloutExposuresSchema),
    evaluationsWithoutIdentifier: v.number(),
    evaluationsFromSdksNotReportingExposures: v.number(),
  }),
  trackedEvents: v.object({ events: v.array(v.object({ name: v.string(), contexts: v.number() })) }),
  results: ResultsSchema,
});

export type ExperimentRun = v.InferOutput<typeof ExperimentRunSchema>;

export const ExperimentRunsSchema = v.array(ExperimentRunSchema);

export type RunEndRequest = { note?: string };

export type ShipVariationRequest = RunEndRequest & { variationId: string };
