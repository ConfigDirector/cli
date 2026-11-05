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

const ExperimentRunSchema = v.object({
  startedAt: TimestampSchema,
  endedAt: v.optional(TimestampSchema),
  outcome: v.optional(v.string()),
  shippedVariationId: v.optional(v.string()),
  rollouts: v.array(v.object({ ruleId: v.string(), conditions: v.optional(v.string()) })),
  exposures: v.object({
    rollouts: v.array(RolloutExposuresSchema),
    evaluationsWithoutIdentifier: v.number(),
    evaluationsFromSdksNotReportingExposures: v.number(),
  }),
});

export type ExperimentRun = v.InferOutput<typeof ExperimentRunSchema>;

export const ExperimentRunsSchema = v.array(ExperimentRunSchema);
