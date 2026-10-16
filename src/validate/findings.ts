import { isEnumConfig, type Config } from "../admin-api/AdminApiClient.js";
import type { CodeReference } from "../scan/code-references.js";
import type { InCodeDefaultValue } from "../scan/literals.js";
import { sdkFamilies, sdkTypes, type GetterType, type SdkType } from "../scan/sdk-families.js";

type DirectCodeReference = Extract<CodeReference, { kind: "direct" }>;

export type Finding = { reference: DirectCodeReference } & (
  | { kind: "unknown-key" }
  | { kind: "deprecated-key"; currentKey: string }
  | { kind: "type-mismatch"; typeRead: GetterType; configType: string; servedAs: ServedValueType }
  | { kind: "availability-mismatch"; sdkType: SdkType; configAvailableTo: SdkType[] }
  | { kind: "enum-value-not-allowed"; inCodeDefault: InCodeDefaultValue; allowedValues: string[] }
);

export type CodeReferenceCheck = { referencesChecked: number; findings: Finding[] };

type KeyMatch =
  { kind: "currentKey"; config: Config } | { kind: "deprecatedKey"; config: Config } | { kind: "unknownKey" };

type ConfigKeyMatch = Exclude<KeyMatch, { kind: "unknownKey" }>;

export type ServedValueType =
  "boolean" | "string" | "integer" | "float" | "json" | "string-enum" | "number-enum";

const servedValueTypesOfConfigTypes = new Map<string, ServedValueType>([
  ["boolean", "boolean"],
  ["string", "string"],
  ["url", "string"],
  ["integer", "integer"],
  ["float", "float"],
  ["timespan", "float"],
  ["json", "json"],
]);

const servedValueTypesReadableAs: { [T in GetterType]: readonly ServedValueType[] } = {
  boolean: ["boolean"],
  string: ["string", "string-enum", "number-enum"],
  integer: ["integer", "float", "number-enum"],
  float: ["float", "number-enum"],
  number: ["integer", "float", "number-enum"],
  json: ["json"],
};

const servedValueTypesOfEnumValueTypes = new Map<string, ServedValueType>([
  ["string", "string-enum"],
  ["number", "number-enum"],
]);

const isServedTo: { [T in SdkType]: (config: Config) => boolean } = {
  client: (config) => config.client,
  server: (config) => config.server,
};

const keyMatchesOfConfigs = (configs: readonly Config[]): ReadonlyMap<string, ConfigKeyMatch> =>
  new Map(
    configs.flatMap((config): Array<[string, ConfigKeyMatch]> => [
      [config.key, { kind: "currentKey", config }],
      ...config.deprecatedKeys.map((deprecatedKey): [string, ConfigKeyMatch] => [
        deprecatedKey.key,
        { kind: "deprecatedKey", config },
      ]),
    ]),
  );

const typesReadBy = (reference: DirectCodeReference): GetterType[] => [
  ...(reference.getterType === undefined ? [] : [reference.getterType]),
  ...(reference.inCodeDefault === undefined ? [] : [reference.inCodeDefault.type]),
];

const servedValueTypeOf = (config: Config): ServedValueType | undefined =>
  isEnumConfig(config)
    ? servedValueTypesOfEnumValueTypes.get(config.typeOptions.valueType)
    : servedValueTypesOfConfigTypes.get(config.type);

const isAllowedValue = (inCodeDefault: InCodeDefaultValue, allowedValues: readonly string[]): boolean => {
  switch (inCodeDefault.type) {
    case "string":
      return allowedValues.includes(inCodeDefault.value);
    case "integer":
    case "float":
      return allowedValues.some((allowedValue) => Number(allowedValue) === inCodeDefault.value);
    case "boolean":
    case "json":
      return false;
  }
};

const valueFindings = (reference: DirectCodeReference, config: Config): Finding[] => {
  const servedValueType = servedValueTypeOf(config);
  if (servedValueType === undefined) {
    return [];
  }
  const typeReadMismatch = typesReadBy(reference).find(
    (typeRead) => !servedValueTypesReadableAs[typeRead].includes(servedValueType),
  );
  if (typeReadMismatch !== undefined) {
    return [
      {
        kind: "type-mismatch",
        reference,
        typeRead: typeReadMismatch,
        configType: config.type,
        servedAs: servedValueType,
      },
    ];
  }
  const { inCodeDefault } = reference;
  if (!isEnumConfig(config) || inCodeDefault === undefined) {
    return [];
  }
  const allowedValues = config.typeOptions.values;
  return isAllowedValue(inCodeDefault, allowedValues)
    ? []
    : [{ kind: "enum-value-not-allowed", reference, inCodeDefault, allowedValues }];
};

const availabilityFindings = (reference: DirectCodeReference, config: Config): Finding[] => {
  const { sdkType } = sdkFamilies[reference.sdk];
  if (reference.test || isServedTo[sdkType](config)) {
    return [];
  }
  const configAvailableTo = sdkTypes.filter((servedSdkType) => isServedTo[servedSdkType](config));
  return [{ kind: "availability-mismatch", reference, sdkType, configAvailableTo }];
};

const configFindings = (reference: DirectCodeReference, config: Config): Finding[] => [
  ...valueFindings(reference, config),
  ...availabilityFindings(reference, config),
];

const findingsOfReference = (reference: DirectCodeReference, keyMatch: KeyMatch): Finding[] => {
  switch (keyMatch.kind) {
    case "currentKey":
      return configFindings(reference, keyMatch.config);
    case "deprecatedKey":
      return [
        { kind: "deprecated-key", reference, currentKey: keyMatch.config.key },
        ...configFindings(reference, keyMatch.config),
      ];
    case "unknownKey":
      return [{ kind: "unknown-key", reference }];
  }
};

export const checkCodeReferences = (
  references: readonly CodeReference[],
  configs: readonly Config[],
  ignoredKeys: ReadonlySet<string>,
): CodeReferenceCheck => {
  const keyMatches = keyMatchesOfConfigs(configs);
  const checkedReferences = references.filter(
    (reference): reference is DirectCodeReference =>
      reference.kind === "direct" && !ignoredKeys.has(reference.key),
  );
  return {
    referencesChecked: checkedReferences.length,
    findings: checkedReferences.flatMap((reference) =>
      findingsOfReference(reference, keyMatches.get(reference.key) ?? { kind: "unknownKey" }),
    ),
  };
};
