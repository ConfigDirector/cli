import type { SegmentDefinition } from "../admin-api/segments.js";
import type { ConditionGroup } from "../admin-api/targeting-rules.js";
import { describeConditionGroup } from "../rule-sentences.js";

const conditionGroupLines = (heading: string, groups: ConditionGroup[]): string[] => [
  "",
  heading,
  ...groups.map((group, index) => `  ${index + 1}. ${describeConditionGroup(group)}`),
];

export const segmentText = (
  segment: SegmentDefinition,
  environmentSlugs: ReadonlyMap<string, string>,
): string =>
  [
    segment.key,
    `  Name: ${segment.name}`,
    ...conditionGroupLines("Project definition", segment.groups),
    ...Object.entries(segment.overrides).flatMap(([environmentId, groups]) =>
      conditionGroupLines(`Override in ${environmentSlugs.get(environmentId) ?? environmentId}`, groups),
    ),
    "",
  ].join("\n");
