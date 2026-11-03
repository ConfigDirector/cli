import * as v from "valibot";

export const VariationSchema = v.object({ id: v.string(), name: v.nullish(v.string()) });

export type Variation = v.InferOutput<typeof VariationSchema>;
