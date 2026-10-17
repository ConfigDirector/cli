import { resolve } from "node:path";
import type { SavedContextReference } from "../admin-api/config-evaluation.js";
import { CliError } from "../CliError.js";
import { parseJson, readFileIfPresent } from "../file-contents.js";

export type ContextOptions = {
  contextKind?: string;
  contextId?: string;
  contextName?: string;
  contextTrait?: string[];
  contextJson?: string;
  savedContext?: string;
};

export type ContextForm =
  | { form: "inline"; context: object }
  | { form: "saved"; reference: SavedContextReference }
  | { form: "empty" };

const DEFAULT_CONTEXT_KIND = "user";

const TYPED_TRAIT_MARKER = ":";

const traitUsageError = (trait: string) =>
  new CliError(
    `--context-trait ${trait} is not a trait. Write name=value for a string, or name:=<json> for a typed value, ` +
      "as in plan=pro or beta:=true.",
  );

const parseTraitJson = (trait: string, json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    throw new CliError(
      `--context-trait ${trait} has a value after := that is not JSON. Write name=value for a string.`,
    );
  }
};

const traitEntryOf = (trait: string): [string, unknown] => {
  const separatorIndex = trait.indexOf("=");
  if (separatorIndex === -1) {
    throw traitUsageError(trait);
  }
  const isTyped = trait[separatorIndex - 1] === TYPED_TRAIT_MARKER;
  const name = trait.slice(0, isTyped ? separatorIndex - 1 : separatorIndex);
  if (name === "") {
    throw traitUsageError(trait);
  }
  const value = trait.slice(separatorIndex + 1);
  return [name, isTyped ? parseTraitJson(trait, value) : value];
};

const contextJsonUsageError = () =>
  new CliError(
    '--context-json takes the context as a JSON object, as in {"kind":"user","identifier":"123"}, or @<file>.',
  );

const isJsonObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const CONTEXT_FILE_MARKER = "@";

const contextJsonText = async (contextJson: string, workingDirectory: string): Promise<string> => {
  if (!contextJson.startsWith(CONTEXT_FILE_MARKER)) {
    return contextJson;
  }
  const file = resolve(workingDirectory, contextJson.slice(CONTEXT_FILE_MARKER.length));
  const contents = await readFileIfPresent(file);
  if (contents === undefined) {
    throw new CliError(`--context-json names ${file}, which does not exist.`);
  }
  return contents;
};

const contextOfJson = async (contextJson: string, workingDirectory: string): Promise<object> => {
  const context = parseJson(await contextJsonText(contextJson, workingDirectory));
  if (!isJsonObject(context)) {
    throw contextJsonUsageError();
  }
  return context;
};

const inlineContextOf = (options: ContextOptions): object => ({
  kind: options.contextKind ?? DEFAULT_CONTEXT_KIND,
  identifier: options.contextId,
  name: options.contextName,
  traits:
    options.contextTrait === undefined
      ? undefined
      : Object.fromEntries(options.contextTrait.map(traitEntryOf)),
});

const SAVED_CONTEXT_SEPARATOR = ":";

const savedContextReferenceOf = (savedContext: string): SavedContextReference => {
  const separatorIndex = savedContext.indexOf(SAVED_CONTEXT_SEPARATOR);
  const kind = savedContext.slice(0, separatorIndex);
  const identifier = savedContext.slice(separatorIndex + SAVED_CONTEXT_SEPARATOR.length);
  if (separatorIndex === -1 || kind === "" || identifier === "") {
    throw new CliError(`--saved-context takes <kind>:<identifier>, as in user:123, not ${savedContext}.`);
  }
  return { kind, identifier };
};

type ContextDoor = {
  optionNames: string[];
  contextForm: (workingDirectory: string) => Promise<ContextForm>;
};

const givenInlineOptionNames = (options: ContextOptions): string[] => [
  ...(options.contextKind === undefined ? [] : ["--context-kind"]),
  ...(options.contextId === undefined ? [] : ["--context-id"]),
  ...(options.contextName === undefined ? [] : ["--context-name"]),
  ...(options.contextTrait === undefined ? [] : ["--context-trait"]),
];

const givenContextDoors = (options: ContextOptions): ContextDoor[] => {
  const { savedContext, contextJson } = options;
  const inlineOptionNames = givenInlineOptionNames(options);
  return [
    ...(savedContext === undefined
      ? []
      : [
          {
            optionNames: ["--saved-context"],
            contextForm: async (): Promise<ContextForm> => ({
              form: "saved",
              reference: savedContextReferenceOf(savedContext),
            }),
          },
        ]),
    ...(contextJson === undefined
      ? []
      : [
          {
            optionNames: ["--context-json"],
            contextForm: async (workingDirectory: string): Promise<ContextForm> => ({
              form: "inline",
              context: await contextOfJson(contextJson, workingDirectory),
            }),
          },
        ]),
    ...(inlineOptionNames.length === 0
      ? []
      : [
          {
            optionNames: inlineOptionNames,
            contextForm: async (): Promise<ContextForm> => ({
              form: "inline",
              context: inlineContextOf(options),
            }),
          },
        ]),
  ];
};

export const contextFormOf = async (
  options: ContextOptions,
  workingDirectory: string,
): Promise<ContextForm> => {
  const [door, ...otherDoors] = givenContextDoors(options);
  if (door === undefined) {
    return { form: "empty" };
  }
  if (otherDoors.length > 0) {
    throw new CliError(
      `${door.optionNames.join(", ")} cannot be combined with ` +
        `${otherDoors.flatMap((otherDoor) => otherDoor.optionNames).join(", ")}. ` +
        "Give the context one way: --saved-context, --context-json, " +
        "or the --context-kind, --context-id, --context-name and --context-trait options.",
    );
  }
  return door.contextForm(workingDirectory);
};
