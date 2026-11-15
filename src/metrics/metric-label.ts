import type { MetricDefinition, MetricFilterCondition, RatioSide, Retention } from "../admin-api/metrics.js";
import { capitalized } from "../capitalized.js";
import { kindReportedAloneBy } from "./metric-definition.js";
import { isOneOf, kindWords } from "./metric-words.js";

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

type FilteredEvent = { eventName: string; filter: MetricFilterCondition[] | null };

const eventNameAndFilterWords = ({ eventName, filter }: FilteredEvent): string[] => {
  const conditions = (filter ?? []).map(conditionWords);
  return conditions.length === 0 ? [eventName] : [eventName, conditions.join(" and ")];
};

const valueFromFieldWords = (valueField: string): string => `value from ${valueField}`;

const RATIO_SIDE_ADDS = ["events", "value"] as const;

type RatioSideAdds = (typeof RATIO_SIDE_ADDS)[number];

const WHAT_A_RATIO_SIDE_ADDS: { [Adds in RatioSideAdds]: (valueField: string | null) => string } = {
  events: () => "events",
  value: (valueField) => (valueField === null ? "value" : valueFromFieldWords(valueField)),
};

const ratioSideWords = (side: RatioSide): string => {
  const adds = isOneOf(RATIO_SIDE_ADDS, side.adds)
    ? WHAT_A_RATIO_SIDE_ADDS[side.adds](side.valueField)
    : side.adds;
  return `${eventNameAndFilterWords(side).join(" · ")} ${adds}`;
};

export type RetentionSpan =
  { span: "one-day"; day: number } | { span: "several-days"; firstDay: number; lastDay: number };

export const retentionSpanOf = ({
  firstDay,
  lastDay,
}: Pick<Retention, "firstDay" | "lastDay">): RetentionSpan =>
  firstDay === lastDay ? { span: "one-day", day: firstDay } : { span: "several-days", firstDay, lastDay };

export const retentionDaysWords = (retention: Pick<Retention, "firstDay" | "lastDay">): string => {
  const retentionSpan = retentionSpanOf(retention);
  switch (retentionSpan.span) {
    case "one-day":
      return `day ${retentionSpan.day}`;
    case "several-days":
      return `days ${retentionSpan.firstDay} to ${retentionSpan.lastDay}`;
  }
};

const definitionWords = (definition: MetricDefinition): string => {
  switch (definition.definedBy) {
    case "event-name": {
      const valueFieldWords =
        definition.valueField === null ? [] : [valueFromFieldWords(definition.valueField)];
      return [...eventNameAndFilterWords(definition), ...valueFieldWords].join(" · ");
    }
    case "ratio":
      return `${ratioSideWords(definition.ratio.numerator)} ÷ ${ratioSideWords(definition.ratio.denominator)}`;
    case "funnel":
      return definition.funnel.steps.map((step) => eventNameAndFilterWords(step).join(" · ")).join(" → ");
    case "retention":
      return [
        ...eventNameAndFilterWords(definition.retention),
        retentionDaysWords(definition.retention),
      ].join(" · ");
  }
};

export const metricLabel = (metric: { definition: MetricDefinition }): string => {
  const kindReportedAlone = kindReportedAloneBy(metric);
  const words = definitionWords(metric.definition);
  return kindReportedAlone === undefined ? words : `${capitalized(kindWords(kindReportedAlone))}: ${words}`;
};
