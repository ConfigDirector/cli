import * as v from "valibot";
import { ConditionGroupSchema } from "./targeting-rules.js";

export const SegmentSchema = v.object({
  id: v.string(),
  key: v.string(),
  name: v.string(),
  usages: v.array(v.unknown()),
});

export type Segment = v.InferOutput<typeof SegmentSchema>;

export const SegmentDefinitionSchema = v.object({
  id: v.string(),
  key: v.string(),
  name: v.string(),
  groups: v.array(ConditionGroupSchema),
  overrides: v.record(v.string(), v.array(ConditionGroupSchema)),
});

export type SegmentDefinition = v.InferOutput<typeof SegmentDefinitionSchema>;

const SegmentUsageSchema = v.object({
  configKey: v.string(),
  environmentIds: v.array(v.string()),
});

export type SegmentUsage = v.InferOutput<typeof SegmentUsageSchema>;

export const SegmentInUseBodySchema = v.object({
  code: v.literal("SEGMENT_IN_USE"),
  usages: v.array(SegmentUsageSchema),
});
