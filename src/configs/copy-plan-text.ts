import type { Project } from "../admin-api/AdminApiClient.js";
import type { CopyPlan } from "../admin-api/config-copy.js";
import { alignedColumns } from "../aligned-columns.js";
import { plural } from "../plural.js";
import { sameSlug } from "../same-slug.js";
import { environmentLabel } from "./config-text.js";

export type CopyMode = "copy" | "dry-run";

export type ConfigCopying = {
  sourceKey: string;
  sourceProject: Project;
  copyKey: string;
  destinationProject: Project;
};

type PlanWording = {
  headline: (copying: ConfigCopying) => string;
  rulesCopied: string;
  ruleDropped: string;
  skippedSourceEnvironmentsHeading: string;
  tagCreated: string;
  tagSkipped: string;
};

const PLAN_WORDING: { [M in CopyMode]: PlanWording } = {
  copy: {
    headline: (copying) =>
      `Copied ${copying.sourceKey} in ${copying.sourceProject.slug} ` +
      `to ${copying.copyKey} in ${copying.destinationProject.slug}.`,
    rulesCopied: "copied",
    ruleDropped: "dropped",
    skippedSourceEnvironmentsHeading: "Skipped source environments:",
    tagCreated: "created",
    tagSkipped: "skipped",
  },
  "dry-run": {
    headline: (copying) =>
      "Nothing was created: this is the plan for copying " +
      `${copying.sourceKey} in ${copying.sourceProject.slug} ` +
      `to ${copying.copyKey} in ${copying.destinationProject.slug}.`,
    rulesCopied: "would be copied",
    ruleDropped: "would be dropped",
    skippedSourceEnvironmentsHeading: "Source environments that would be skipped:",
    tagCreated: "would be created",
    tagSkipped: "would be skipped",
  },
};

type WordedPlan = { plan: CopyPlan; destinationProjectSlug: string; wording: PlanWording };

type PlannedEnvironment = CopyPlan["environments"][number];

type DroppedRule = PlannedEnvironment["droppedRules"][number];

const droppedRuleDescription = (wordedPlan: WordedPlan, droppedRule: DroppedRule): string =>
  `rule ${droppedRule.position} ${wordedPlan.wording.ruleDropped}: ` +
  `${wordedPlan.destinationProjectSlug} has no segment ${droppedRule.segmentKey}`;

const environmentColumnsOf = (wordedPlan: WordedPlan, environment: PlannedEnvironment): string[] => [
  environmentLabel(environment),
  `from ${environment.sourceSlug}`,
  `${environment.rulesCopied} ${plural(environment.rulesCopied, "rule", "rules")} ${wordedPlan.wording.rulesCopied}`,
  ...(environment.droppedRules.length === 0
    ? []
    : [
        environment.droppedRules
          .map((droppedRule) => droppedRuleDescription(wordedPlan, droppedRule))
          .join("; "),
      ]),
];

type SkippedSourceEnvironmentReason =
  | { reason: "no-destination-environment" }
  | { reason: "destination-copies-another-source"; destinationEnvironment: PlannedEnvironment };

const skippedSourceEnvironmentReasonOf = (plan: CopyPlan, slug: string): SkippedSourceEnvironmentReason => {
  const destinationEnvironment = plan.environments.find((environment) => sameSlug(environment.slug, slug));
  return destinationEnvironment === undefined
    ? { reason: "no-destination-environment" }
    : { reason: "destination-copies-another-source", destinationEnvironment };
};

const skippedSourceEnvironmentDescription = (
  destinationProjectSlug: string,
  slug: string,
  skipped: SkippedSourceEnvironmentReason,
): string => {
  switch (skipped.reason) {
    case "no-destination-environment":
      return `${destinationProjectSlug} has no environment with this slug; create it there to copy its rules`;
    case "destination-copies-another-source":
      return (
        `${skipped.destinationEnvironment.slug} in ${destinationProjectSlug} copies from ` +
        `${skipped.destinationEnvironment.sourceSlug} instead; ` +
        `--environment ${skipped.destinationEnvironment.slug}=${slug} copies this one`
      );
  }
};

const skippedSourceEnvironmentRowsOf = ({ plan, destinationProjectSlug }: WordedPlan): string[][] =>
  plan.skippedSourceEnvironments.map((slug) => [
    slug,
    skippedSourceEnvironmentDescription(
      destinationProjectSlug,
      slug,
      skippedSourceEnvironmentReasonOf(plan, slug),
    ),
  ]);

const tagRowsOf = ({ plan, wording }: WordedPlan): string[][] => [
  ...plan.tags.matched.map((name) => [name, "matched"]),
  ...plan.tags.created.map((name) => [name, wording.tagCreated]),
  ...plan.tags.skipped.map((name) => [name, `${wording.tagSkipped}: the API token cannot create tags`]),
];

const sectionLines = (heading: string, rows: string[][]): string[] =>
  rows.length === 0 ? [] : [heading, ...alignedColumns(rows).map((line) => `  ${line}`)];

export const copyPlanText = (copying: ConfigCopying, plan: CopyPlan, mode: CopyMode): string => {
  const wordedPlan = {
    plan,
    destinationProjectSlug: copying.destinationProject.slug,
    wording: PLAN_WORDING[mode],
  };
  return [
    wordedPlan.wording.headline(copying),
    ...sectionLines(
      "Environments:",
      plan.environments.map((environment) => environmentColumnsOf(wordedPlan, environment)),
    ),
    ...sectionLines(
      wordedPlan.wording.skippedSourceEnvironmentsHeading,
      skippedSourceEnvironmentRowsOf(wordedPlan),
    ),
    ...sectionLines("Tags:", tagRowsOf(wordedPlan)),
    "",
  ].join("\n");
};
