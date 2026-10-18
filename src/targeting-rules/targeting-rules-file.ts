import { randomUUID } from "node:crypto";
import { text as wholeText } from "node:stream/consumers";
import { CliError } from "../CliError.js";
import { isJsonObject, parseJson, readOptionFile, type JsonObject } from "../file-contents.js";
import type { Invocation } from "../Invocation.js";

const STANDARD_INPUT_ARGUMENT = "-";

type RulesSource = { origin: string; contents: string };

const readRulesSource = async (rulesArgument: string, invocation: Invocation): Promise<RulesSource> => {
  if (rulesArgument === STANDARD_INPUT_ARGUMENT) {
    return { origin: "--rules reads stdin", contents: await wholeText(invocation.stdin) };
  }
  const { file, contents } = await readOptionFile("--rules", rulesArgument, invocation.workingDirectory);
  return { origin: `--rules names ${file}`, contents };
};

export const readTargetingRulesFile = async (
  rulesArgument: string,
  invocation: Invocation,
): Promise<JsonObject> => {
  const { origin, contents } = await readRulesSource(rulesArgument, invocation);
  const targetingRules = parseJson(contents);
  if (!isJsonObject(targetingRules)) {
    throw new CliError(
      `${origin}, which does not hold a JSON object. It takes ` +
        '{"defaultValue": ..., "rules": [...]}, like an entry of targets in configs get --json.',
    );
  }
  return targetingRules;
};

const withId = (entry: JsonObject): JsonObject =>
  entry.id === undefined ? { id: randomUUID(), ...entry } : entry;

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
