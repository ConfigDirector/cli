import type {
  AttributeCondition,
  AttributeConditionExplanation,
  Bucket,
  Condition,
  ConfigEvaluation,
  Percentage,
  Rule,
  RuleExplanation,
  SegmentConditionExplanation,
} from "../admin-api/config-evaluation.js";
import type { ContextForm } from "./context-form.js";

type Segments = ConfigEvaluation["segments"];

type CheckedConditionExplanation = AttributeConditionExplanation | SegmentConditionExplanation;

const RULE_COLUMN_GAP = "   ";

const TRAIT_POINTER_PREFIX = "/";

const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  identifier: "context identifier",
  kind: "context kind",
  name: "context name",
  appName: "app name",
  appVersion: "app version",
};

const RESOLVED_VALUE_DESCRIPTIONS: {
  [T in AttributeConditionExplanation["resolvedType"]]: (resolvedValue: unknown) => string;
} = {
  absent: () => "absent",
  "unknown-attribute": () => "unknown to the evaluator",
  scalar: (resolvedValue) => JSON.stringify(resolvedValue),
  array: (resolvedValue) => JSON.stringify(resolvedValue),
  object: (resolvedValue) => JSON.stringify(resolvedValue),
};

const formatPercentage = (value: number): string => Number(value.toFixed(3)).toString();

const contextDescription = (evaluation: ConfigEvaluation, contextForm: ContextForm): string => {
  const evaluatedContext = evaluation.context;
  if (evaluatedContext === null) {
    return "an empty context";
  }
  if (evaluatedContext.identifier === null) {
    return `a ${evaluatedContext.kind} context without an identifier`;
  }
  const identity = `${evaluatedContext.kind} ${evaluatedContext.identifier}`;
  return contextForm.form === "saved" ? `saved context ${identity}` : identity;
};

const servedByDescription = (evaluation: ConfigEvaluation): string => {
  const { servedBy } = evaluation;
  switch (servedBy.kind) {
    case "rule":
      return `served by rule ${evaluation.rules.findIndex((rule) => rule.ruleId === servedBy.ruleId) + 1}`;
    case "default":
      return "served by the default targeting rule";
  }
};

const subjectOf = (condition: AttributeCondition): string => {
  if (condition.attribute === "traits" && condition.trait != null) {
    return condition.trait.startsWith(TRAIT_POINTER_PREFIX)
      ? condition.trait.slice(TRAIT_POINTER_PREFIX.length)
      : condition.trait;
  }
  return ATTRIBUTE_LABELS[condition.attribute] ?? condition.attribute;
};

const segmentNameOf = (segmentId: string, segments: Segments): string =>
  segments[segmentId]?.name ?? segmentId;

const describeCondition = (condition: Condition, segments: Segments): string => {
  switch (condition.kind) {
    case "attribute":
      return `${subjectOf(condition)} ${condition.operator} ${condition.targetValues.map(String).join(", ")}`;
    case "segment":
      return `${condition.operator} segment ${segmentNameOf(condition.segmentId, segments)}`;
  }
};

const describePercentages = (percentages: Percentage[]): string =>
  percentages
    .map((percentage) => `${formatPercentage(percentage.percentage)}% get ${String(percentage.value)}`)
    .join(", ");

const describeRule = (rule: Rule, segments: Segments): string => {
  if (rule.type === "percentage") {
    return describePercentages(rule.percentages);
  }
  const conditions = rule.conditions.map((condition) => describeCondition(condition, segments)).join(" and ");
  return `${conditions}: ${rule.target === "value" ? String(rule.value) : describePercentages(rule.percentages)}`;
};

const describeShareRange = (from: number, to: number): string =>
  `${formatPercentage(from)} to ${formatPercentage(to)}`;

const bucketPlacement = (bucket: Bucket): string => {
  const assigned = `bucket ${bucket.assignedPercentage.toFixed(1)}`;
  const selectedShare = bucket.shares.find((share) => share.percentageId === bucket.selectedPercentageId);
  if (selectedShare !== undefined) {
    return `${assigned} is in ${describeShareRange(selectedShare.from, selectedShare.to)}`;
  }
  return `${assigned} is outside ${describeShareRange(0, bucket.shares.at(-1)?.to ?? 0)}`;
};

const describeBucket = (bucket: Bucket): string =>
  bucket.defaultedToPredefinedBucket
    ? `no identifier, so ${bucketPlacement(bucket)}`
    : bucketPlacement(bucket);

const withBucket = (outcome: string, bucket: Bucket | undefined): string =>
  bucket === undefined ? outcome : `${outcome}: ${describeBucket(bucket)}`;

const conditionsOf = (rule: Rule | undefined): Condition[] =>
  rule?.type === "conditional" ? rule.conditions : [];

const segmentMismatchEvidence = (explanation: SegmentConditionExplanation): string => {
  if (!explanation.segmentFound) {
    return "the segment was not found";
  }
  return explanation.matchedGroupIndex === undefined
    ? "no group matched"
    : `group ${explanation.matchedGroupIndex + 1} matched`;
};

const mismatchEvidence = (failingCondition: CheckedConditionExplanation): string => {
  switch (failingCondition.kind) {
    case "attribute":
      return `it is ${RESOLVED_VALUE_DESCRIPTIONS[failingCondition.resolvedType](failingCondition.resolvedValue)}`;
    case "segment":
      return segmentMismatchEvidence(failingCondition);
  }
};

const isFailingCondition = (
  condition: RuleExplanation["conditions"][number],
): condition is CheckedConditionExplanation => condition.outcome === "not-matched";

const failingConditionDescription = (
  explanation: RuleExplanation,
  conditions: Condition[],
  segments: Segments,
): string | undefined => {
  const failingCondition = explanation.conditions.find(isFailingCondition);
  const condition = conditions.find((ruleCondition) => ruleCondition.id === failingCondition?.conditionId);
  return failingCondition === undefined || condition === undefined
    ? undefined
    : `${describeCondition(condition, segments)}, but ${mismatchEvidence(failingCondition)}`;
};

const describeNotMatched = (
  explanation: RuleExplanation,
  conditions: Condition[],
  segments: Segments,
): string => {
  const failingCondition = failingConditionDescription(explanation, conditions, segments);
  return failingCondition === undefined
    ? withBucket("not matched", explanation.bucket)
    : `not matched: ${failingCondition}`;
};

const RULE_OUTCOME_DESCRIPTIONS: {
  [O in RuleExplanation["outcome"]]: (
    explanation: RuleExplanation,
    conditions: Condition[],
    segments: Segments,
  ) => string;
} = {
  matched: (explanation) => withBucket("matched", explanation.bucket),
  "not-matched": describeNotMatched,
  "not-evaluated": () => "not evaluated",
  errored: () => "errored",
};

const ruleLines = (evaluation: ConfigEvaluation): string[] => {
  const rulesById = new Map(evaluation.targetingRules.rules.map((rule) => [rule.id, rule]));
  const describedRules = evaluation.rules.map((explanation, index) => {
    const rule = rulesById.get(explanation.ruleId);
    return {
      rule: `${index + 1}. ${rule === undefined ? explanation.ruleId : describeRule(rule, evaluation.segments)}`,
      outcome: RULE_OUTCOME_DESCRIPTIONS[explanation.outcome](
        explanation,
        conditionsOf(rule),
        evaluation.segments,
      ),
    };
  });
  const ruleColumnWidth = Math.max(0, ...describedRules.map((describedRule) => describedRule.rule.length));
  return describedRules.map(
    (describedRule) =>
      `${describedRule.rule.padEnd(ruleColumnWidth)}${RULE_COLUMN_GAP}${describedRule.outcome}`,
  );
};

const oldKeyLines = (evaluation: ConfigEvaluation, requestedKey: string): string[] =>
  requestedKey === evaluation.key ? [] : [`${requestedKey} is an old key of ${evaluation.key}.`];

export const evaluationText = (
  evaluation: ConfigEvaluation,
  requested: { configKey: string; contextForm: ContextForm },
): string =>
  [
    ...oldKeyLines(evaluation, requested.configKey),
    `${evaluation.key} in ${evaluation.environment.name} for ${contextDescription(evaluation, requested.contextForm)}`,
    "",
    `${evaluation.value ?? "no value"}, ${servedByDescription(evaluation)}`,
    "",
    ...ruleLines(evaluation),
    `Default targeting rule: ${evaluation.targetingRules.defaultValue}`,
    "",
  ].join("\n");
