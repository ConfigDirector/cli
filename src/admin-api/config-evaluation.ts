import * as v from "valibot";
import { RuleSchema } from "./targeting-rules.js";

export type SavedContextReference = { kind: string; identifier: string };

export type EvaluateConfigRequest = {
  environmentId: string;
  context?: object;
  savedContext?: SavedContextReference;
};

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
