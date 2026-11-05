import * as v from "valibot";
import { RuleValueSchema } from "./targeting-rules.js";

export const VariationSchema = v.object({
  id: v.string(),
  name: v.nullish(v.string()),
  value: RuleValueSchema,
});

export type Variation = v.InferOutput<typeof VariationSchema>;
