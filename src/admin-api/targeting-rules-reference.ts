import * as v from "valibot";

export const TargetingRulesReferenceSchema = v.object({
  notes: v.array(v.string()),
  conditionKinds: v.array(v.string()),
  conditionAttributes: v.array(v.string()),
  contextKindOperators: v.array(v.string()),
  segmentOperators: v.array(v.string()),
  operatorsByTargetType: v.record(v.string(), v.array(v.string())),
});

export type TargetingRulesReference = v.InferOutput<typeof TargetingRulesReferenceSchema>;
