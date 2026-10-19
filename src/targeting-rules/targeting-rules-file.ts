import { isJsonObject, type JsonObject } from "../file-contents.js";
import type { Invocation } from "../Invocation.js";
import { readRequestFile, withId } from "../request-file.js";

export const readTargetingRulesFile = (rulesArgument: string, invocation: Invocation): Promise<JsonObject> =>
  readRequestFile(
    "--rules",
    rulesArgument,
    invocation,
    'It takes {"defaultValue": ..., "rules": [...]}, like an entry of targets in configs get --json.',
  );

const conditionOrPercentageWithId = (conditionOrPercentage: unknown): unknown =>
  isJsonObject(conditionOrPercentage) ? withId(conditionOrPercentage) : conditionOrPercentage;

const conditionsOrPercentagesWithIds = (
  rule: JsonObject,
  field: "conditions" | "percentages",
): JsonObject => {
  const conditionsOrPercentages = rule[field];
  return Array.isArray(conditionsOrPercentages)
    ? { [field]: conditionsOrPercentages.map(conditionOrPercentageWithId) }
    : {};
};

const ruleWithIds = (rule: unknown): unknown =>
  isJsonObject(rule)
    ? {
        ...withId(rule),
        ...conditionsOrPercentagesWithIds(rule, "conditions"),
        ...conditionsOrPercentagesWithIds(rule, "percentages"),
      }
    : rule;

export const withGeneratedIds = (targetingRules: JsonObject): JsonObject =>
  Array.isArray(targetingRules.rules)
    ? { ...targetingRules, rules: targetingRules.rules.map(ruleWithIds) }
    : targetingRules;
