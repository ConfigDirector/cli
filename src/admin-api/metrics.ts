import * as v from "valibot";
import type { JsonObject } from "../file-contents.js";

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

const MetricFilterSchema = v.nullable(v.array(MetricFilterConditionSchema));

type MetricFilter = v.InferOutput<typeof MetricFilterSchema>;

const RatioSideSchema = v.object({
  eventName: v.string(),
  adds: v.string(),
  filter: MetricFilterSchema,
  valueField: v.nullable(v.string()),
});

export type RatioSide = v.InferOutput<typeof RatioSideSchema>;

const RatioSchema = v.object({ numerator: RatioSideSchema, denominator: RatioSideSchema });

const FunnelStepSchema = v.object({ eventName: v.string(), filter: MetricFilterSchema });

const FunnelSchema = v.object({ steps: v.array(FunnelStepSchema) });

const RetentionSchema = v.object({
  eventName: v.string(),
  filter: MetricFilterSchema,
  firstDay: v.number(),
  lastDay: v.number(),
});

export type Retention = v.InferOutput<typeof RetentionSchema>;

export const MetricDefinitionEntries = {
  eventName: v.nullable(v.string()),
  filter: MetricFilterSchema,
  valueField: v.nullable(v.string()),
  ratio: v.nullable(RatioSchema),
  funnel: v.nullable(FunnelSchema),
  retention: v.nullable(RetentionSchema),
};

type MetricDefinitionFields = v.InferOutput<v.ObjectSchema<typeof MetricDefinitionEntries, undefined>>;

export type MetricDefinition =
  | { definedBy: "event-name"; eventName: string; filter: MetricFilter; valueField: string | null }
  | { definedBy: "ratio"; ratio: v.InferOutput<typeof RatioSchema> }
  | { definedBy: "funnel"; funnel: v.InferOutput<typeof FunnelSchema> }
  | { definedBy: "retention"; retention: Retention };

const metricDefinitionOf = ({
  eventName,
  filter,
  valueField,
  ratio,
  funnel,
  retention,
}: MetricDefinitionFields): MetricDefinition | undefined => {
  if (ratio !== null) {
    return { definedBy: "ratio", ratio };
  }
  if (funnel !== null) {
    return { definedBy: "funnel", funnel };
  }
  if (retention !== null) {
    return { definedBy: "retention", retention };
  }
  if (eventName !== null) {
    return { definedBy: "event-name", eventName, filter, valueField };
  }
  return undefined;
};

export const withItsDefinition = <Fields extends MetricDefinitionFields>() =>
  v.rawTransform<Fields, Fields & { definition: MetricDefinition }>(({ dataset, addIssue, NEVER }) => {
    const definition = metricDefinitionOf(dataset.value);
    if (definition === undefined) {
      addIssue({ message: "A metric has an event name, a ratio, a funnel or a retention" });
      return NEVER;
    }
    return { ...dataset.value, definition };
  });

export const MetricSchema = v.pipe(
  v.object({
    id: v.string(),
    ...MetricDefinitionEntries,
    description: v.nullable(v.string()),
    direction: v.string(),
    kinds: v.array(v.string()),
    usages: v.array(MetricUsageSchema),
  }),
  withItsDefinition(),
);

export type Metric = v.InferOutput<typeof MetricSchema>;

export type MetricDefinitionRequest =
  | { eventName: string; filter?: unknown[]; valueField?: string; kinds: string[] }
  | { ratio: JsonObject; kinds: ["ratio"] }
  | { funnel: JsonObject; kinds: ["funnel"] }
  | { retention: JsonObject; kinds: ["retention"] };

export type CreateMetricRequest = MetricDefinitionRequest & { direction: string; description?: string };

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
