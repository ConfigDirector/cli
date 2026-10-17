import type { ConfigValue, CreateConfigRequest } from "../admin-api/config-creation.js";
import { CliError } from "../CliError.js";
import { atFileArgumentText, parseJson, readOptionFile } from "../file-contents.js";

export const CONFIG_TYPES = [
  "boolean",
  "string",
  "integer",
  "float",
  "timespan",
  "enum",
  "url",
  "json",
] as const;

type ConfigType = (typeof CONFIG_TYPES)[number];

export const CONFIG_ROLES = ["config", "flag", "kill-switch", "experiment"] as const;

export const CONFIG_LIFETIMES = ["permanent", "temporary"] as const;

export const TIMESPAN_UNITS = ["milliseconds", "seconds", "minutes"] as const;

export const ENUM_VALUE_TYPES = ["string", "number"] as const;

type EnumValueType = (typeof ENUM_VALUE_TYPES)[number];

const DEFAULT_ENUM_VALUE_TYPE: EnumValueType = "string";

type TypeConstraintOptions = {
  min?: string;
  max?: string;
  exclusiveMin?: string;
  exclusiveMax?: string;
  unit?: (typeof TIMESPAN_UNITS)[number];
  allowFractions?: true;
  allowedValue?: string[];
  enumValueType?: EnumValueType;
  httpsOnly?: true;
  jsonSchema?: string;
};

type TypeConstraintOption = keyof TypeConstraintOptions;

const TYPE_CONSTRAINT_OPTION_NAMES: { [O in TypeConstraintOption]: string } = {
  min: "--min",
  max: "--max",
  exclusiveMin: "--exclusive-min",
  exclusiveMax: "--exclusive-max",
  unit: "--unit",
  allowFractions: "--allow-fractions",
  allowedValue: "--allowed-value",
  enumValueType: "--enum-value-type",
  httpsOnly: "--https-only",
  jsonSchema: "--json-schema",
};

export type NewConfigOptions = TypeConstraintOptions & {
  key: string;
  description?: string;
  type: ConfigType;
  role: (typeof CONFIG_ROLES)[number];
  lifetime: (typeof CONFIG_LIFETIMES)[number];
  defaultValue: string;
  clientOnly?: true;
  serverOnly?: true;
  variation?: string[];
};

type Availability = Pick<CreateConfigRequest, "client" | "server">;

const availabilityOf = (options: NewConfigOptions): Availability => {
  if (options.clientOnly) {
    return { client: true, server: false };
  }
  if (options.serverOnly) {
    return { client: false, server: true };
  }
  return { client: true, server: true };
};

export type NewConfig = Omit<CreateConfigRequest, "tagIds">;

type ValueArgument = { argumentLabel: string; text: string; workingDirectory: string };

type ConfigTypeRules = {
  constraintOptions: readonly TypeConstraintOption[];
  valueDescription: string;
  valueOf: (argument: ValueArgument) => Promise<ConfigValue | undefined>;
  typeOptionsOf: (options: TypeConstraintOptions, workingDirectory: string) => Promise<object | undefined>;
};

const BOOLEAN_VALUES: ReadonlyMap<string, boolean> = new Map([
  ["true", true],
  ["false", false],
]);

const numberOf = (text: string): number | undefined => {
  const value = parseJson(text);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

type NumberOption = "min" | "max" | "exclusiveMin" | "exclusiveMax";

const constraintNumberOf = (options: TypeConstraintOptions, option: NumberOption): number | undefined => {
  const text = options[option];
  if (text === undefined) {
    return undefined;
  }
  const value = numberOf(text);
  if (value === undefined) {
    throw new CliError(`${TYPE_CONSTRAINT_OPTION_NAMES[option]} takes a number, not ${text}.`);
  }
  return value;
};

type NumericBound = { relation: string; value: number };

const boundOf = (
  options: TypeConstraintOptions,
  option: NumberOption,
  relation: string,
): NumericBound | undefined => {
  const value = constraintNumberOf(options, option);
  return value === undefined ? undefined : { relation, value };
};

const numericBoundsOf = (options: TypeConstraintOptions) => ({
  min: boundOf(options, "min", ">=") ?? boundOf(options, "exclusiveMin", ">"),
  max: boundOf(options, "max", "<=") ?? boundOf(options, "exclusiveMax", "<"),
});

const jsonTextOf = async ({
  argumentLabel,
  text,
  workingDirectory,
}: ValueArgument): Promise<string | undefined> => {
  const jsonText = (await atFileArgumentText(argumentLabel, text, workingDirectory)).trim();
  return parseJson(jsonText) === undefined ? undefined : jsonText;
};

const jsonSchemaOptionsOf = async (options: TypeConstraintOptions, workingDirectory: string) => {
  if (options.jsonSchema === undefined) {
    return undefined;
  }
  const { file, contents } = await readOptionFile(
    TYPE_CONSTRAINT_OPTION_NAMES.jsonSchema,
    options.jsonSchema,
    workingDirectory,
  );
  const schema = parseJson(contents);
  if (schema === undefined) {
    throw new CliError(`${TYPE_CONSTRAINT_OPTION_NAMES.jsonSchema} names ${file}, which is not JSON.`);
  }
  return { useSchema: true, schema };
};

const timespanRangeOf = async (options: TypeConstraintOptions) => {
  if (options.unit === undefined || options.min === undefined || options.max === undefined) {
    throw new CliError("--type timespan needs --unit, --min and --max.");
  }
  return {
    unit: options.unit,
    min: constraintNumberOf(options, "min"),
    max: constraintNumberOf(options, "max"),
    allowFractions: options.allowFractions,
  };
};

const NUMERIC_BOUND_OPTIONS: readonly TypeConstraintOption[] = ["min", "max", "exclusiveMin", "exclusiveMax"];

const CONFIG_TYPE_RULES: { [T in ConfigType]: ConfigTypeRules } = {
  boolean: {
    constraintOptions: [],
    valueDescription: "true or false",
    valueOf: async ({ text }) => BOOLEAN_VALUES.get(text),
    typeOptionsOf: async () => undefined,
  },
  string: {
    constraintOptions: [],
    valueDescription: "text",
    valueOf: async ({ text }) => text,
    typeOptionsOf: async () => undefined,
  },
  integer: {
    constraintOptions: NUMERIC_BOUND_OPTIONS,
    valueDescription: "a number",
    valueOf: async ({ text }) => numberOf(text),
    typeOptionsOf: async (options) => ({ isInteger: true, ...numericBoundsOf(options) }),
  },
  float: {
    constraintOptions: NUMERIC_BOUND_OPTIONS,
    valueDescription: "a number",
    valueOf: async ({ text }) => numberOf(text),
    typeOptionsOf: async (options) => ({ isInteger: false, ...numericBoundsOf(options) }),
  },
  timespan: {
    constraintOptions: ["min", "max", "unit", "allowFractions"],
    valueDescription: "a number",
    valueOf: async ({ text }) => numberOf(text),
    typeOptionsOf: timespanRangeOf,
  },
  enum: {
    constraintOptions: ["allowedValue", "enumValueType"],
    valueDescription: "text",
    valueOf: async ({ text }) => text,
    typeOptionsOf: async (options) => ({
      values: options.allowedValue ?? [],
      valueType: options.enumValueType ?? DEFAULT_ENUM_VALUE_TYPE,
    }),
  },
  url: {
    constraintOptions: ["httpsOnly"],
    valueDescription: "text",
    valueOf: async ({ text }) => text,
    typeOptionsOf: async (options) => ({ secureOnly: options.httpsOnly === true }),
  },
  json: {
    constraintOptions: ["jsonSchema"],
    valueDescription: "JSON or @<file>",
    valueOf: jsonTextOf,
    typeOptionsOf: jsonSchemaOptionsOf,
  },
};

const typeAlternatives = (types: readonly string[]): string =>
  types.length === 1 ? `${types[0]}` : `${types.slice(0, -1).join(", ")} or ${types.at(-1)}`;

const typesTaking = (option: TypeConstraintOption): ConfigType[] =>
  CONFIG_TYPES.filter((type) => CONFIG_TYPE_RULES[type].constraintOptions.includes(option));

export const typeConstraintHelpGroup = (option: TypeConstraintOption): string =>
  `Options for --type ${typeAlternatives(typesTaking(option))}:`;

const TYPE_CONSTRAINT_OPTIONS = Object.keys(TYPE_CONSTRAINT_OPTION_NAMES) as TypeConstraintOption[];

const rejectOptionsOfOtherTypes = (options: NewConfigOptions): void => {
  const { constraintOptions } = CONFIG_TYPE_RULES[options.type];
  const otherTypeOption = TYPE_CONSTRAINT_OPTIONS.find(
    (option) => options[option] !== undefined && !constraintOptions.includes(option),
  );
  if (otherTypeOption !== undefined) {
    throw new CliError(
      `${TYPE_CONSTRAINT_OPTION_NAMES[otherTypeOption]} cannot be used with --type ${options.type}. ` +
        `It applies to --type ${typeAlternatives(typesTaking(otherTypeOption))}.`,
    );
  }
};

const typedValueOf = async (type: ConfigType, argument: ValueArgument): Promise<ConfigValue> => {
  const rules = CONFIG_TYPE_RULES[type];
  const value = await rules.valueOf(argument);
  if (value === undefined) {
    throw new CliError(
      `${argument.argumentLabel} takes ${rules.valueDescription} with --type ${type}, not ${argument.text}.`,
    );
  }
  return value;
};

type Variation = NewConfig["variations"][number];

const VARIATION_SEPARATOR = "=";

const variationOf = async (
  type: ConfigType,
  variation: string,
  workingDirectory: string,
): Promise<Variation> => {
  const separatorIndex = variation.indexOf(VARIATION_SEPARATOR);
  const name = variation.slice(0, separatorIndex);
  if (separatorIndex === -1 || name === "") {
    throw new CliError(`--variation takes name=value, not ${variation}.`);
  }
  const text = variation.slice(separatorIndex + VARIATION_SEPARATOR.length);
  return {
    name,
    value: await typedValueOf(type, { argumentLabel: `--variation ${name}`, text, workingDirectory }),
  };
};

const variationsOf = async (options: NewConfigOptions, workingDirectory: string): Promise<Variation[]> => {
  const variations: Variation[] = [];
  for (const variation of options.variation ?? []) {
    variations.push(await variationOf(options.type, variation, workingDirectory));
  }
  return variations;
};

export const newConfigOf = async (
  options: NewConfigOptions,
  workingDirectory: string,
): Promise<NewConfig> => {
  rejectOptionsOfOtherTypes(options);
  return {
    key: options.key,
    description: options.description,
    role: options.role,
    lifetime: options.lifetime,
    type: options.type,
    typeOptions: await CONFIG_TYPE_RULES[options.type].typeOptionsOf(options, workingDirectory),
    ...availabilityOf(options),
    variations: await variationsOf(options, workingDirectory),
    defaultValue: await typedValueOf(options.type, {
      argumentLabel: "--default-value",
      text: options.defaultValue,
      workingDirectory,
    }),
  };
};
