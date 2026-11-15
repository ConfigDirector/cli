import type { CreateMetricRequest, MetricDefinitionRequest } from "../admin-api/metrics.js";
import { CliError } from "../CliError.js";
import type { JsonObject } from "../file-contents.js";
import type { Invocation } from "../Invocation.js";
import { listedWithAnd } from "../listed-with-and.js";
import { plural } from "../plural.js";
import { readDefinitionFile } from "./definition-file.js";
import { readFilterFile } from "./filter-file.js";
import { KINDS_WITH_A_METRIC_OF_THEIR_OWN, type KindWithAMetricOfItsOwn } from "./metric-words.js";

export type CreateMetricOptions = {
  eventName?: string;
  ratio?: string;
  funnel?: string;
  retention?: string;
  filter?: string;
  valueField?: string;
  kind?: string[];
  direction: string;
  description?: string;
};

type DefinitionOption =
  | { givenWith: "event-name"; eventName: string; kinds: string[] }
  | { givenWith: KindWithAMetricOfItsOwn; file: string };

const definitionOptionsGiven = (options: CreateMetricOptions): DefinitionOption[] => [
  ...(options.eventName === undefined
    ? []
    : [{ givenWith: "event-name" as const, eventName: options.eventName, kinds: options.kind ?? [] }]),
  ...KINDS_WITH_A_METRIC_OF_THEIR_OWN.flatMap((kind) => {
    const file = options[kind];
    return file === undefined ? [] : [{ givenWith: kind, file }];
  }),
];

const optionsOnlyForAnEventName = (options: CreateMetricOptions): string[] => [
  ...(options.kind === undefined ? [] : ["--kind"]),
  ...(options.filter === undefined ? [] : ["--filter"]),
  ...(options.valueField === undefined ? [] : ["--value-field"]),
];

const definitionOptionOf = (options: CreateMetricOptions): DefinitionOption => {
  const [definitionOption, ...otherDefinitionOptions] = definitionOptionsGiven(options);
  if (definitionOption === undefined) {
    throw new CliError("Say what the metric measures with --event-name, --ratio, --funnel or --retention.");
  }
  if (otherDefinitionOptions.length > 0) {
    throw new CliError("Give only one of --event-name, --ratio, --funnel and --retention.");
  }
  if (definitionOption.givenWith === "event-name") {
    if (definitionOption.kinds.length === 0) {
      throw new CliError("--event-name needs at least one --kind.");
    }
    return definitionOption;
  }
  const optionsThatDoNotApply = optionsOnlyForAnEventName(options);
  if (optionsThatDoNotApply.length > 0) {
    const kind = definitionOption.givenWith;
    throw new CliError(
      `${listedWithAnd(optionsThatDoNotApply)} ${plural(optionsThatDoNotApply.length, "does", "do")} not apply ` +
        `with --${kind}: the --${kind} file holds the whole definition, and a ${kind} metric reports the ${kind} kind alone.`,
    );
  }
  return definitionOption;
};

const DEFINITION_REQUEST_OF_A_METRIC_OF_ITS_OWN: {
  [Kind in KindWithAMetricOfItsOwn]: (definition: JsonObject) => MetricDefinitionRequest;
} = {
  ratio: (ratio) => ({ ratio, kinds: ["ratio"] }),
  funnel: (funnel) => ({ funnel, kinds: ["funnel"] }),
  retention: (retention) => ({ retention, kinds: ["retention"] }),
};

const definitionRequestOf = async (
  options: CreateMetricOptions,
  invocation: Invocation,
): Promise<MetricDefinitionRequest> => {
  const definitionOption = definitionOptionOf(options);
  switch (definitionOption.givenWith) {
    case "event-name":
      return {
        eventName: definitionOption.eventName,
        ...(options.filter === undefined ? {} : { filter: await readFilterFile(options.filter, invocation) }),
        ...(options.valueField === undefined ? {} : { valueField: options.valueField }),
        kinds: definitionOption.kinds,
      };
    case "ratio":
    case "funnel":
    case "retention":
      return DEFINITION_REQUEST_OF_A_METRIC_OF_ITS_OWN[definitionOption.givenWith](
        await readDefinitionFile(definitionOption.givenWith, definitionOption.file, invocation),
      );
  }
};

export const newMetricOf = async (
  options: CreateMetricOptions,
  invocation: Invocation,
): Promise<CreateMetricRequest> => ({
  ...(await definitionRequestOf(options, invocation)),
  direction: options.direction,
  ...(options.description === undefined ? {} : { description: options.description }),
});
