import type {
  AttributeCondition,
  Condition,
  ConditionGroup,
  Percentage,
  Rule,
  RuleValue,
} from "./admin-api/targeting-rules.js";
import type { Variation } from "./admin-api/variations.js";

export type SegmentsById = Readonly<Record<string, { name: string }>>;

const TRAIT_POINTER_PREFIX = "/";

const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  identifier: "context identifier",
  kind: "context kind",
  name: "context name",
  appName: "app name",
  appVersion: "app version",
};

export const formatPercentage = (value: number): string => Number(value.toFixed(3)).toString();

const subjectOf = (condition: AttributeCondition): string => {
  if (condition.attribute === "traits" && condition.trait != null) {
    return condition.trait.startsWith(TRAIT_POINTER_PREFIX)
      ? condition.trait.slice(TRAIT_POINTER_PREFIX.length)
      : condition.trait;
  }
  return ATTRIBUTE_LABELS[condition.attribute] ?? condition.attribute;
};

const segmentNameOf = (segmentId: string, segments: SegmentsById): string =>
  segments[segmentId]?.name ?? segmentId;

const describeAttributeCondition = (condition: AttributeCondition): string =>
  `${subjectOf(condition)} ${condition.operator} ${condition.targetValues.map(String).join(", ")}`;

export const describeConditionGroup = (group: ConditionGroup): string =>
  group.map(describeAttributeCondition).join(" and ");

export const describeCondition = (condition: Condition, segments: SegmentsById): string => {
  switch (condition.kind) {
    case "attribute":
      return describeAttributeCondition(condition);
    case "segment":
      return `${condition.operator} segment ${segmentNameOf(condition.segmentId, segments)}`;
  }
};

export const valueWithVariationName = (value: RuleValue, variationName: string | null | undefined): string =>
  variationName ? `${variationName} (${String(value)})` : String(value);

export const describeVariation = (variation: Variation): string =>
  valueWithVariationName(variation.value, variation.name);

export const describeValue = (
  value: RuleValue,
  variationId: string | undefined,
  variations: Variation[],
): string =>
  valueWithVariationName(value, variations.find((variation) => variation.id === variationId)?.name);

const describePercentages = (percentages: Percentage[], variations: Variation[]): string =>
  percentages
    .map(
      (percentage) =>
        `${formatPercentage(percentage.percentage)}% get ${describeValue(percentage.value, percentage.variationId, variations)}`,
    )
    .join(", ");

export const describeRule = (rule: Rule, segments: SegmentsById, variations: Variation[]): string => {
  if (rule.type === "percentage") {
    return describePercentages(rule.percentages, variations);
  }
  const conditions = rule.conditions.map((condition) => describeCondition(condition, segments)).join(" and ");
  return `${conditions}: ${
    rule.target === "value"
      ? describeValue(rule.value, rule.variationId, variations)
      : describePercentages(rule.percentages, variations)
  }`;
};
