import type { TargetingRulesReference } from "../admin-api/targeting-rules-reference.js";

const headedListLines = (heading: string, items: string[]): string[] => [
  heading,
  ...items.map((item) => `  ${item}`),
];

const operatorsByTargetTypeLines = (operatorsByTargetType: Record<string, string[]>): string[] => [
  "Operators per target type:",
  ...Object.entries(operatorsByTargetType).flatMap(([targetType, operators]) => [
    `  ${targetType}:`,
    ...operators.map((operator) => `    ${operator}`),
  ]),
];

export const targetingRulesReferenceText = (reference: TargetingRulesReference): string =>
  [
    ...reference.notes.flatMap((note) => [note, ""]),
    ...headedListLines("Condition kinds:", reference.conditionKinds),
    "",
    ...headedListLines("Attributes a condition can test:", reference.conditionAttributes),
    "",
    ...headedListLines("Context kind operators:", reference.contextKindOperators),
    "",
    ...headedListLines("Segment operators:", reference.segmentOperators),
    "",
    ...operatorsByTargetTypeLines(reference.operatorsByTargetType),
    "",
  ].join("\n");
