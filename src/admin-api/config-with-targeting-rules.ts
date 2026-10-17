import * as v from "valibot";
import { RuleSchema } from "./targeting-rules.js";

const TargetingRulesInEnvironmentSchema = v.object({
  environment: v.object({ slug: v.string(), live: v.boolean() }),
  rules: v.array(RuleSchema),
  defaultValue: v.string(),
});

export type TargetingRulesInEnvironment = v.InferOutput<typeof TargetingRulesInEnvironmentSchema>;

const NumericBoundSchema = v.object({ relation: v.string(), value: v.number() });

const NumericBoundsSchema = v.object({
  min: v.optional(NumericBoundSchema),
  max: v.optional(NumericBoundSchema),
});

export type NumericBounds = v.InferOutput<typeof NumericBoundsSchema>;

const EnumValuesSchema = v.object({ valueType: v.string(), values: v.array(v.string()) });

export type EnumValues = v.InferOutput<typeof EnumValuesSchema>;

const TimespanRangeSchema = v.object({
  unit: v.string(),
  allowFractions: v.nullish(v.boolean()),
  min: v.number(),
  max: v.number(),
});

export type TimespanRange = v.InferOutput<typeof TimespanRangeSchema>;

const ConstrainedTypeSchema = v.variant("type", [
  v.object({ type: v.literal("integer"), typeOptions: v.nullish(NumericBoundsSchema) }),
  v.object({ type: v.literal("float"), typeOptions: v.nullish(NumericBoundsSchema) }),
  v.object({ type: v.literal("enum"), typeOptions: EnumValuesSchema }),
  v.object({ type: v.literal("timespan"), typeOptions: TimespanRangeSchema }),
  v.object({
    type: v.literal("url"),
    typeOptions: v.nullish(v.object({ secureOnly: v.nullish(v.boolean()) })),
  }),
  v.object({
    type: v.literal("json"),
    typeOptions: v.nullish(v.object({ useSchema: v.optional(v.boolean()) })),
  }),
]);

type ConstrainedType = v.InferOutput<typeof ConstrainedTypeSchema>;

const CONSTRAINED_TYPE_NAMES: ReadonlySet<string> = new Set(
  ConstrainedTypeSchema.options.map((option) => option.entries.type.literal),
);

const ConfigTypeSchema = v.union([
  ConstrainedTypeSchema,
  v.object({ type: v.pipe(v.string(), v.notValues([...CONSTRAINED_TYPE_NAMES])) }),
]);

type ConfigType = v.InferOutput<typeof ConfigTypeSchema>;

export const hasTypeConstraints = (configType: ConfigType): configType is ConstrainedType =>
  CONSTRAINED_TYPE_NAMES.has(configType.type);

export const ConfigWithTargetingRulesSchema = v.intersect([
  v.object({
    key: v.string(),
    description: v.nullish(v.string()),
    role: v.string(),
    lifetime: v.string(),
    state: v.string(),
    client: v.boolean(),
    server: v.boolean(),
    tags: v.array(v.object({ name: v.string() })),
    targets: v.array(TargetingRulesInEnvironmentSchema),
  }),
  ConfigTypeSchema,
]);

export type ConfigWithTargetingRules = v.InferOutput<typeof ConfigWithTargetingRulesSchema>;
