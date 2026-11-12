export const METRIC_KINDS = ["conversion", "count-per-context", "value-per-context"] as const;

export type MetricKind = (typeof METRIC_KINDS)[number];

export const METRIC_DIRECTIONS = ["higher-is-better", "lower-is-better"] as const;

type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const METRIC_ROLES = ["primary", "secondary", "guardrail"] as const;

type MetricRole = (typeof METRIC_ROLES)[number];

export const isOneOf = <Value extends string>(
  values: readonly Value[],
  candidate: string,
): candidate is Value => (values as readonly string[]).includes(candidate);

export const isMetricKind = (kind: string): kind is MetricKind => isOneOf(METRIC_KINDS, kind);

const KIND_WORDS: { [Kind in MetricKind]: string } = {
  conversion: "conversion",
  "count-per-context": "count per context",
  "value-per-context": "value per context",
};

const DIRECTION_WORDS: { [Direction in MetricDirection]: string } = {
  "higher-is-better": "higher is better",
  "lower-is-better": "lower is better",
};

const ROLE_WORDS: { [Role in MetricRole]: string } = {
  primary: "primary metric",
  secondary: "secondary metric",
  guardrail: "guardrail",
};

export const kindWords = (kind: string): string => (isMetricKind(kind) ? KIND_WORDS[kind] : kind);

export const directionWords = (direction: string): string =>
  isOneOf(METRIC_DIRECTIONS, direction) ? DIRECTION_WORDS[direction] : direction;

export const roleWords = (role: string): string => (isOneOf(METRIC_ROLES, role) ? ROLE_WORDS[role] : role);
