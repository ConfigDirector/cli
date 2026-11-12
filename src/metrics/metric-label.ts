import type { Metric, MetricFilterCondition } from "../admin-api/metrics.js";
import { isOneOf } from "./metric-words.js";

const FILTER_TARGET_TYPES = ["text", "number", "boolean"] as const;

type FilterTargetType = (typeof FILTER_TARGET_TYPES)[number];

const comparisonWithTargetValueList = (condition: MetricFilterCondition): string =>
  `${condition.operator} [${condition.targetValues.join(", ")}]`;

const COMPARISON_WORDS: { [TargetType in FilterTargetType]: (condition: MetricFilterCondition) => string } = {
  text: comparisonWithTargetValueList,
  number: (condition) => `${condition.operator} ${condition.targetValues[0] ?? ""}`,
  boolean: (condition) => `is ${condition.targetValues[0] ?? ""}`,
};

const conditionWords = (condition: MetricFilterCondition): string => {
  const comparison = isOneOf(FILTER_TARGET_TYPES, condition.targetType)
    ? COMPARISON_WORDS[condition.targetType](condition)
    : comparisonWithTargetValueList(condition);
  return `${condition.field} ${comparison}`;
};

type LabeledMetric = Pick<Metric, "eventName" | "filter" | "valueField">;

export const metricLabel = (metric: LabeledMetric): string => {
  const conditions = (metric.filter ?? []).map(conditionWords);
  const filterWords = conditions.length === 0 ? [] : [conditions.join(" and ")];
  const valueFieldWords = metric.valueField === null ? [] : [`value from ${metric.valueField}`];
  return [metric.eventName, ...filterWords, ...valueFieldWords].join(" · ");
};
