import * as v from "valibot";

export type EnvironmentMapping = Record<string, string>;

export type CopyConfigRequest = {
  projectId: string;
  key: string;
  environments: EnvironmentMapping;
  dryRun: boolean;
};

const CopyPlanSchema = v.object({
  environments: v.array(
    v.object({
      slug: v.string(),
      live: v.boolean(),
      sourceSlug: v.string(),
      rulesCopied: v.number(),
      droppedRules: v.array(v.object({ position: v.number(), segmentKey: v.string() })),
    }),
  ),
  skippedSourceEnvironments: v.array(v.string()),
  tags: v.object({
    matched: v.array(v.string()),
    created: v.array(v.string()),
    skipped: v.array(v.string()),
  }),
});

export type CopyPlan = v.InferOutput<typeof CopyPlanSchema>;

export const CopyPlanResponseSchema = v.object({ plan: CopyPlanSchema });

export type CopyPlanResponse = v.InferOutput<typeof CopyPlanResponseSchema>;
