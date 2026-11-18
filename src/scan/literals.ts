import { isAsciiLetter, isDigit, type SourceCode, type TokenRange } from "./source-code.js";
import { languageSyntax } from "./source-languages.js";

export type InCodeDefaultValue =
  | { type: "boolean"; value: boolean }
  | { type: "integer" | "float"; value: number }
  | { type: "string"; value: string }
  | { type: "json"; value: string };

export type KeyExpression = { range: TokenRange; isName: boolean };

type KeyLiteral = { kind: "key"; key: string } | { kind: "outsideKeyGrammar" } | { kind: "notLiteral" };

const MINIMUM_KEY_LENGTH = 4;
const MAXIMUM_KEY_LENGTH = 150;
const NUMBER_LITERAL = /^-?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[fFdDmMlL]?$/;
const FLOAT_MARKERS = [".", "e", "E", "f", "F", "d", "D", "m", "M"];

const isAlphanumeric = (character: string) => isDigit(character) || isAsciiLetter(character);

const isKeyCharacter = (character: string) =>
  isAlphanumeric(character) || character === "." || character === "_" || character === "-";

export const fitsKeyGrammar = (text: string) =>
  text.length >= MINIMUM_KEY_LENGTH &&
  text.length <= MAXIMUM_KEY_LENGTH &&
  isAlphanumeric(text.charAt(0)) &&
  [...text].every(isKeyCharacter);

const singleToken = (code: SourceCode, range: TokenRange) =>
  range.first === range.last ? code.token(range.first) : undefined;

export const plainStringContent = (code: SourceCode, range: TokenRange): string | undefined => {
  const token = singleToken(code, range);
  return token?.kind === "string" ? token.plainContent : undefined;
};

const opensSymbol = (code: SourceCode, index: number): boolean => {
  const symbolOpener = languageSyntax[code.language].symbolOpener;
  return (
    symbolOpener !== undefined &&
    code.isPunctuation(index, symbolOpener) &&
    code.areAdjacent(index, index + 1)
  );
};

export const keyExpressionOf = (code: SourceCode, range: TokenRange): KeyExpression => {
  const symbolName = code.token(range.last);
  const isSymbol =
    range.last === range.first + 1 &&
    opensSymbol(code, range.first) &&
    (symbolName?.kind === "identifier" || symbolName?.kind === "string");
  return isSymbol
    ? { range: { first: range.last, last: range.last }, isName: symbolName.kind === "identifier" }
    : { range, isName: false };
};

export const literalTextOf = (code: SourceCode, expression: KeyExpression): string | undefined =>
  expression.isName ? code.textOf(expression.range) : plainStringContent(code, expression.range);

export const keyLiteralOf = (code: SourceCode, expression: KeyExpression): KeyLiteral => {
  const content = literalTextOf(code, expression);
  if (content === undefined) {
    return { kind: "notLiteral" };
  }
  return fitsKeyGrammar(content) ? { kind: "key", key: content } : { kind: "outsideKeyGrammar" };
};

const isLiteralGroup = (code: SourceCode, range: TokenRange) =>
  (code.isPunctuation(range.first, "{") || code.isPunctuation(range.first, "[")) &&
  code.closerOf(range.first) === range.last;

const numberLiteralOf = (text: string): InCodeDefaultValue | undefined => {
  if (!NUMBER_LITERAL.test(text)) {
    return undefined;
  }
  const value = Number(text.replace(/[_fFdDmMlL]/g, ""));
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return FLOAT_MARKERS.some((marker) => text.includes(marker))
    ? { type: "float", value }
    : { type: "integer", value };
};

export const inCodeDefaultValueOf = (code: SourceCode, range: TokenRange): InCodeDefaultValue | undefined => {
  const text = code.textOf(range);
  if (text === "true" || text === "True") {
    return { type: "boolean", value: true };
  }
  if (text === "false" || text === "False") {
    return { type: "boolean", value: false };
  }
  const stringContent = plainStringContent(code, range);
  if (stringContent !== undefined) {
    return { type: "string", value: stringContent };
  }
  if (isLiteralGroup(code, range)) {
    return { type: "json", value: text };
  }
  return numberLiteralOf(text);
};
