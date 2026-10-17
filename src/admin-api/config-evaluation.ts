import * as v from "valibot";

export type SavedContextReference = { kind: string; identifier: string };

export type EvaluateConfigRequest = {
  environmentId: string;
  context?: object;
  savedContext?: SavedContextReference;
};

const RuleValueSchema = v.union([v.string(), v.number(), v.boolean()]);

const AttributeConditionSchema = v.object({
  id: v.string(),
  kind: v.literal("attribute"),
  attribute: v.string(),
  trait: v.nullish(v.string()),
  operator: v.string(),
  targetValues: v.array(v.unknown()),
});

export type AttributeCondition = v.InferOutput<typeof AttributeConditionSchema>;

const SegmentConditionSchema = v.object({
  id: v.string(),
  kind: v.literal("segment"),
  operator: v.string(),
  segmentId: v.string(),
});

const ConditionSchema = v.variant("kind", [AttributeConditionSchema, SegmentConditionSchema]);

export type Condition = v.InferOutput<typeof ConditionSchema>;

const PercentageSchema = v.object({ percentage: v.number(), value: RuleValueSchema });

export type Percentage = v.InferOutput<typeof PercentageSchema>;

const RuleSchema = v.variant("type", [
  v.variant("target", [
    v.object({
      id: v.string(),
      type: v.literal("conditional"),
      conditions: v.array(ConditionSchema),
      target: v.literal("value"),
      value: RuleValueSchema,
    }),
    v.object({
      id: v.string(),
      type: v.literal("conditional"),
      conditions: v.array(ConditionSchema),
      target: v.literal("percentage"),
      percentages: v.array(PercentageSchema),
    }),
  ]),
  v.object({ id: v.string(), type: v.literal("percentage"), percentages: v.array(PercentageSchema) }),
]);

export type Rule = v.InferOutput<typeof RuleSchema>;

const CheckedOutcomeSchema = v.picklist(["matched", "not-matched"]);

const AttributeConditionExplanationSchema = v.object({
  conditionId: v.string(),
  kind: v.literal("attribute"),
  outcome: CheckedOutcomeSchema,
  resolvedValue: v.optional(v.unknown()),
  resolvedType: v.picklist(["absent", "scalar", "array", "object", "unknown-attribute"]),
});

export type AttributeConditionExplanation = v.InferOutput<typeof AttributeConditionExplanationSchema>;

const SegmentConditionExplanationSchema = v.object({
  conditionId: v.string(),
  kind: v.literal("segment"),
  outcome: CheckedOutcomeSchema,
  segmentId: v.string(),
  segmentFound: v.boolean(),
  matchedGroupIndex: v.optional(v.number()),
});

export type SegmentConditionExplanation = v.InferOutput<typeof SegmentConditionExplanationSchema>;

const ConditionExplanationSchema = v.union([
  v.object({ conditionId: v.string(), outcome: v.literal("not-evaluated") }),
  AttributeConditionExplanationSchema,
  SegmentConditionExplanationSchema,
]);

const BucketSchema = v.object({
  defaultedToPredefinedBucket: v.boolean(),
  assignedPercentage: v.number(),
  shares: v.array(v.object({ percentageId: v.string(), from: v.number(), to: v.number() })),
  selectedPercentageId: v.optional(v.string()),
});

export type Bucket = v.InferOutput<typeof BucketSchema>;

const RuleExplanationSchema = v.object({
  ruleId: v.string(),
  outcome: v.picklist(["matched", "not-matched", "not-evaluated", "errored"]),
  conditions: v.array(ConditionExplanationSchema),
  bucket: v.optional(BucketSchema),
});

export type RuleExplanation = v.InferOutput<typeof RuleExplanationSchema>;

export const ConfigEvaluationSchema = v.object({
  key: v.string(),
  environment: v.object({ name: v.string() }),
  context: v.nullable(v.object({ kind: v.string(), identifier: v.nullable(v.string()) })),
  value: v.optional(v.string()),
  servedBy: v.variant("kind", [
    v.object({ kind: v.literal("rule"), ruleId: v.string() }),
    v.object({ kind: v.literal("default") }),
  ]),
  rules: v.array(RuleExplanationSchema),
  targetingRules: v.object({ rules: v.array(RuleSchema), defaultValue: v.string() }),
  segments: v.record(v.string(), v.object({ name: v.string() })),
});

export type ConfigEvaluation = v.InferOutput<typeof ConfigEvaluationSchema>;

export type ReceivedConfigEvaluation = { evaluation: ConfigEvaluation; responseBody: unknown };
