import * as v from "valibot";

const RuleValueSchema = v.union([v.string(), v.number(), v.boolean()]);

const attributeConditionEntries = {
  attribute: v.string(),
  trait: v.nullish(v.string()),
  operator: v.string(),
  targetValues: v.array(v.unknown()),
};

const AttributeConditionSchema = v.object(attributeConditionEntries);

export type AttributeCondition = v.InferOutput<typeof AttributeConditionSchema>;

export const ConditionGroupSchema = v.array(AttributeConditionSchema);

export type ConditionGroup = v.InferOutput<typeof ConditionGroupSchema>;

const SegmentConditionSchema = v.object({
  id: v.string(),
  kind: v.literal("segment"),
  operator: v.string(),
  segmentId: v.string(),
});

const ConditionSchema = v.variant("kind", [
  v.object({ id: v.string(), kind: v.literal("attribute"), ...attributeConditionEntries }),
  SegmentConditionSchema,
]);

export type Condition = v.InferOutput<typeof ConditionSchema>;

const PercentageSchema = v.object({ percentage: v.number(), value: RuleValueSchema });

export type Percentage = v.InferOutput<typeof PercentageSchema>;

export const RuleSchema = v.variant("type", [
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
