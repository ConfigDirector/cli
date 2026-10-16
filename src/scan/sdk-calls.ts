import {
  inCodeDefaultValueOf,
  keyLiteralOf,
  literalTextOf,
  type InCodeDefaultValue,
  type KeyExpression,
} from "./literals.js";
import { mapLiteralEntries } from "./map-literals.js";
import type { ArgumentSlot, CallShape, GetterType, KeyArgument, SdkFamily } from "./sdk-families.js";
import type { SourceCode, TokenRange } from "./source-code.js";

export type DirectReference = {
  key: string;
  line: number;
  sdk: SdkFamily;
  call: string;
  inCodeDefault: InCodeDefaultValue | undefined;
  getterType: GetterType | undefined;
  test: boolean;
};

export type DynamicReference = { line: number; sdk: SdkFamily; call: string; argument: string };

export type FamilyCallShape = { sdk: SdkFamily; shape: CallShape };

type FileReferences = { direct: DirectReference[]; dynamic: DynamicReference[] };

type CallArgument = { label: string | undefined; range: TokenRange };

const LABEL_SEPARATORS = new Set([":", "="]);
const CHARACTERS_EXTENDING_A_SEPARATOR = new Set([":", "=", ">"]);

const labelledArgument = (code: SourceCode, item: TokenRange): CallArgument => {
  const labelToken = code.token(item.first);
  const separator = code.token(item.first + 1);
  const isLabel =
    labelToken?.kind === "identifier" &&
    separator?.kind === "punctuation" &&
    LABEL_SEPARATORS.has(separator.text) &&
    !CHARACTERS_EXTENDING_A_SEPARATOR.has(code.characterAfter(item.first + 1)) &&
    item.first + 2 <= item.last;
  return isLabel
    ? { label: labelToken.text, range: { first: item.first + 2, last: item.last } }
    : { label: undefined, range: item };
};

const argumentInSlot = (callArguments: CallArgument[], slot: ArgumentSlot): CallArgument | undefined => {
  const labelled = callArguments.find(
    (argument) => slot.label !== undefined && argument.label === slot.label,
  );
  if (labelled !== undefined) {
    return labelled;
  }
  const positional = slot.position === undefined ? undefined : callArguments[slot.position];
  return positional?.label === undefined ? positional : undefined;
};

const precedingTokenMatchesForm = (code: SourceCode, nameIndex: number, shape: CallShape) => {
  switch (shape.form) {
    case "method":
      return code.isPunctuation(nameIndex - 1, ".");
    case "annotation":
      return code.isPunctuation(nameIndex - 1, "@");
    case "function":
      return true;
  }
};

const TOKENS_SEARCHED_FOR_THE_END_OF_TYPE_ARGUMENTS = 64;
const TOKENS_ENDING_A_SEARCH_FOR_TYPE_ARGUMENTS = new Set(["(", ")", "{", "}", ";"]);

const indexAfterTypeArguments = (code: SourceCode, openingAngleBracket: number): number | undefined => {
  let depth = 0;
  const lastSearched = openingAngleBracket + TOKENS_SEARCHED_FOR_THE_END_OF_TYPE_ARGUMENTS;
  for (let index = openingAngleBracket; index <= lastSearched; index += 1) {
    const token = code.token(index);
    if (
      token === undefined ||
      (token.kind === "punctuation" && TOKENS_ENDING_A_SEARCH_FOR_TYPE_ARGUMENTS.has(token.text))
    ) {
      return undefined;
    }
    if (code.isPunctuation(index, "<")) {
      depth += 1;
    } else if (code.isPunctuation(index, ">")) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return undefined;
};

const openingParenthesisAfterName = (code: SourceCode, nameIndex: number): number | undefined => {
  const afterName = code.opensTypeArguments(nameIndex + 1)
    ? indexAfterTypeArguments(code, nameIndex + 1)
    : nameIndex + 1;
  return afterName !== undefined && code.isPunctuation(afterName, "(") ? afterName : undefined;
};

const mapKeyExpressions = (
  code: SourceCode,
  range: TokenRange,
  property: string | undefined,
): KeyExpression[] => {
  const entries = mapLiteralEntries[code.language](code, range);
  if (entries === undefined) {
    return [{ range, isName: false }];
  }
  if (property === undefined) {
    return entries.map((entry) => ({ range: entry.key, isName: entry.keyIsName }));
  }
  const propertyEntry = entries.find(
    (entry) => literalTextOf(code, { range: entry.key, isName: entry.keyIsName }) === property,
  );
  return propertyEntry?.value === undefined ? [] : mapKeyExpressions(code, propertyEntry.value, undefined);
};

const keyExpressionsOf = (
  code: SourceCode,
  callArguments: CallArgument[],
  keyArgument: KeyArgument,
): KeyExpression[] => {
  const argument = argumentInSlot(callArguments, keyArgument.slot);
  if (argument === undefined) {
    return [];
  }
  switch (keyArgument.kind) {
    case "key":
      return [{ range: argument.range, isName: false }];
    case "mapKeys":
      return mapKeyExpressions(code, argument.range, keyArgument.property);
  }
};

const callArgumentsOf = (code: SourceCode, nameIndex: number): CallArgument[] | undefined => {
  const openingParenthesis = openingParenthesisAfterName(code, nameIndex);
  const items = openingParenthesis === undefined ? undefined : code.commaSeparatedItems(openingParenthesis);
  return items?.map((item) => labelledArgument(code, item));
};

const hasArgumentCountOf = (shape: CallShape, callArguments: CallArgument[]) =>
  shape.argumentCount === undefined ||
  (callArguments.length >= shape.argumentCount.minimum &&
    callArguments.length <= (shape.argumentCount.maximum ?? Number.POSITIVE_INFINITY));

const collectCallReferences = (
  code: SourceCode,
  nameIndex: number,
  sdk: SdkFamily,
  shape: CallShape,
  references: FileReferences,
) => {
  const callArguments = precedingTokenMatchesForm(code, nameIndex, shape)
    ? callArgumentsOf(code, nameIndex)
    : undefined;
  if (callArguments === undefined || !hasArgumentCountOf(shape, callArguments)) {
    return;
  }
  const inCodeDefaultArgument =
    shape.inCodeDefault === undefined ? undefined : argumentInSlot(callArguments, shape.inCodeDefault);
  const inCodeDefault =
    inCodeDefaultArgument === undefined ? undefined : inCodeDefaultValueOf(code, inCodeDefaultArgument.range);
  for (const expression of keyExpressionsOf(code, callArguments, shape.keyArgument)) {
    const line = code.lineOf(expression.range.first);
    const keyLiteral = keyLiteralOf(code, expression);
    switch (keyLiteral.kind) {
      case "key":
        references.direct.push({
          key: keyLiteral.key,
          line,
          sdk,
          call: shape.name,
          inCodeDefault,
          getterType: shape.getterType,
          test: shape.test,
        });
        break;
      case "notLiteral":
        references.dynamic.push({
          line,
          sdk,
          call: shape.name,
          argument: code.textOf(expression.range),
        });
        break;
      case "outsideKeyGrammar":
        break;
    }
  }
};

export const sdkCallReferences = (
  code: SourceCode,
  callShapes: readonly FamilyCallShape[],
): FileReferences => {
  const shapesByName = new Map<string, FamilyCallShape[]>();
  for (const callShape of callShapes) {
    const shapesNamedAlike = shapesByName.get(callShape.shape.name);
    if (shapesNamedAlike === undefined) {
      shapesByName.set(callShape.shape.name, [callShape]);
    } else {
      shapesNamedAlike.push(callShape);
    }
  }
  const references: FileReferences = { direct: [], dynamic: [] };
  code.tokens.forEach((token, index) => {
    if (token.kind !== "identifier") {
      return;
    }
    for (const { sdk, shape } of shapesByName.get(token.text) ?? []) {
      collectCallReferences(code, index, sdk, shape, references);
    }
  });
  return references;
};
