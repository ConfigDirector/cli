import { randomUUID } from "node:crypto";
import { text as wholeText } from "node:stream/consumers";
import { CliError } from "./CliError.js";
import { isJsonObject, parseJson, readOptionFile, type JsonObject } from "./file-contents.js";
import type { Invocation } from "./Invocation.js";

const STANDARD_INPUT_ARGUMENT = "-";

type RequestSource = { origin: string; contents: string };

const readRequestSource = async (
  argumentLabel: string,
  argument: string,
  invocation: Invocation,
): Promise<RequestSource> => {
  if (argument === STANDARD_INPUT_ARGUMENT) {
    return { origin: `${argumentLabel} reads stdin`, contents: await wholeText(invocation.stdin) };
  }
  const { file, contents } = await readOptionFile(argumentLabel, argument, invocation.workingDirectory);
  return { origin: `${argumentLabel} names ${file}`, contents };
};

export const readRequestFile = async (
  argumentLabel: string,
  argument: string,
  invocation: Invocation,
  expectedFormatSentence: string,
): Promise<JsonObject> => {
  const { origin, contents } = await readRequestSource(argumentLabel, argument, invocation);
  const request = parseJson(contents);
  if (!isJsonObject(request)) {
    throw new CliError(`${origin}, which does not hold a JSON object. ${expectedFormatSentence}`);
  }
  return request;
};

export const withId = (entry: JsonObject): JsonObject =>
  entry.id === undefined ? { id: randomUUID(), ...entry } : entry;
