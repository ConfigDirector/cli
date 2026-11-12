import * as v from "valibot";

const OpenRunsSchema = v.array(v.object({ environmentId: v.string() }));

export type OpenRuns = v.InferOutput<typeof OpenRunsSchema>;

const MetricUsageSchema = v.object({
  configKey: v.string(),
  role: v.string(),
  primaryKind: v.nullable(v.string()),
  openRuns: OpenRunsSchema,
});

export type MetricUsage = v.InferOutput<typeof MetricUsageSchema>;

const MetricFilterConditionSchema = v.object({
  field: v.string(),
  targetType: v.string(),
  operator: v.string(),
  targetValues: v.array(v.string()),
});

export type MetricFilterCondition = v.InferOutput<typeof MetricFilterConditionSchema>;

export const MetricFilterSchema = v.nullable(v.array(MetricFilterConditionSchema));

export const MetricSchema = v.object({
  id: v.string(),
  eventName: v.string(),
  filter: MetricFilterSchema,
  valueField: v.nullable(v.string()),
  description: v.nullable(v.string()),
  direction: v.string(),
  kinds: v.array(v.string()),
  usages: v.array(MetricUsageSchema),
});

export type Metric = v.InferOutput<typeof MetricSchema>;

export type CreateMetricRequest = {
  eventName: string;
  filter?: unknown[];
  valueField?: string;
  kinds: string[];
  direction: string;
  description?: string;
};

export type UpdateMetricRequest = {
  kinds?: string[];
  direction?: string;
  description?: string;
};

const DecidingExperimentSchema = v.object({ configKey: v.string(), primaryKind: v.string() });

export type DecidingExperiment = v.InferOutput<typeof DecidingExperimentSchema>;

export const MetricKindInUseBodySchema = v.object({
  code: v.literal("METRIC_KIND_IN_USE"),
  usages: v.array(DecidingExperimentSchema),
});

const ExperimentWithOpenRunsSchema = v.object({ configKey: v.string(), openRuns: OpenRunsSchema });

export type ExperimentWithOpenRuns = v.InferOutput<typeof ExperimentWithOpenRunsSchema>;

export const MetricInUseBodySchema = v.object({
  code: v.literal("METRIC_IN_USE"),
  usages: v.array(ExperimentWithOpenRunsSchema),
});
