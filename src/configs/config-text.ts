import {
  hasTypeConstraints,
  type ConfigWithTargetingRules,
  type EnumValues,
  type NumericBounds,
  type TargetingRulesInEnvironment,
  type TimespanRange,
} from "../admin-api/config-with-targeting-rules.js";
import { oldKeyLines } from "../old-key-lines.js";
import { describeRule, type SegmentsById } from "../rule-sentences.js";

const boundsDescriptions = (bounds: NumericBounds | null | undefined): string[] => {
  const limits = [bounds?.min, bounds?.max].flatMap((bound) =>
    bound === undefined ? [] : [`${bound.relation} ${bound.value}`],
  );
  return limits.length === 0 ? [] : [limits.join(" and ")];
};

const enumValuesDescription = ({ valueType, values }: EnumValues): string =>
  valueType === "number" ? `one of the numbers ${values.join(", ")}` : `one of ${values.join(", ")}`;

const timespanRangeDescriptions = (range: TimespanRange): string[] => [
  `${range.min} to ${range.max} ${range.unit}`,
  ...(range.allowFractions ? ["fractions allowed"] : []),
];

const typeConstraintDescriptions = (config: ConfigWithTargetingRules): string[] => {
  if (!hasTypeConstraints(config)) {
    return [];
  }
  switch (config.type) {
    case "integer":
    case "float":
      return boundsDescriptions(config.typeOptions);
    case "enum":
      return [enumValuesDescription(config.typeOptions)];
    case "timespan":
      return timespanRangeDescriptions(config.typeOptions);
    case "url":
      return config.typeOptions?.secureOnly ? ["HTTPS only"] : [];
    case "json":
      return config.typeOptions?.useSchema ? ["checked against a JSON schema"] : [];
  }
};

const availabilityDescription = (config: ConfigWithTargetingRules): string => {
  if (config.client && config.server) {
    return "client and server SDKs";
  }
  if (config.client) {
    return "client-only";
  }
  if (config.server) {
    return "server-only";
  }
  return "served to no SDK";
};

const settingLines = (config: ConfigWithTargetingRules): string[] => [
  ...(config.description ? [`Description: ${config.description}`] : []),
  `Type: ${[config.type, ...typeConstraintDescriptions(config)].join(", ")}`,
  `Role: ${config.role}`,
  `Lifetime: ${config.lifetime}`,
  `Availability: ${availabilityDescription(config)}`,
  `Lifecycle state: ${config.state}`,
  ...(config.tags.length === 0 ? [] : [`Tags: ${config.tags.map((tag) => tag.name).join(", ")}`]),
];

const environmentHeading = (targetingRules: TargetingRulesInEnvironment): string =>
  targetingRules.environment.live
    ? `${targetingRules.environment.slug} (live)`
    : targetingRules.environment.slug;

const targetingRuleLines = (
  targetingRules: TargetingRulesInEnvironment,
  segments: SegmentsById,
): string[] => [
  environmentHeading(targetingRules),
  ...targetingRules.rules.map((rule, index) => `  ${index + 1}. ${describeRule(rule, segments)}`),
  `  Default targeting rule: ${targetingRules.defaultValue}`,
];

export const configText = (
  config: ConfigWithTargetingRules,
  requestedKey: string,
  segments: SegmentsById,
): string =>
  [
    ...oldKeyLines(requestedKey, config.key),
    config.key,
    ...settingLines(config).map((line) => `  ${line}`),
    ...config.targets.flatMap((targetingRules) => ["", ...targetingRuleLines(targetingRules, segments)]),
    "",
  ].join("\n");
