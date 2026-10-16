import { languageSyntax, type LanguageSyntax, type SourceLanguage } from "./source-languages.js";

type TokenKind = "identifier" | "string" | "number" | "punctuation";

type SourceToken = { kind: TokenKind; text: string; start: number; end: number };

export type TokenRange = { first: number; last: number };

const closerOfOpener: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const closers = new Set(Object.values(closerOfOpener));
const quotes = new Set(['"', "'", "`"]);
const OPENERS_SEARCHED_FOR_A_CLOSER = 8;

export const isAsciiLetter = (character: string) =>
  (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");

export const isDigit = (character: string) => character >= "0" && character <= "9";

const isIdentifierStart = (character: string) =>
  isAsciiLetter(character) || character === "_" || character === "$" || character > "\u007f";

const isIdentifierPart = (character: string) => isIdentifierStart(character) || isDigit(character);

const isWhitespace = (character: string) =>
  character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";

const endOfLine = (source: string, start: number): number => {
  const newline = source.indexOf("\n", start);
  return newline === -1 ? source.length : newline;
};

const endOfComment = (source: string, start: number, syntax: LanguageSyntax): number | undefined => {
  if (source.startsWith(syntax.lineComment, start)) {
    return endOfLine(source, start);
  }
  if (syntax.blockComments && source.startsWith("/*", start)) {
    const close = source.indexOf("*/", start + 2);
    return close === -1 ? source.length : close + 2;
  }
  return undefined;
};

const endOfStringLiteral = (source: string, start: number): number => {
  const quote = source.charAt(start);
  const tripleQuote = quote.repeat(3);
  if (quote !== "`" && source.startsWith(tripleQuote, start)) {
    const close = source.indexOf(tripleQuote, start + 3);
    return close === -1 ? source.length : close + 3;
  }
  let index = start + 1;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 2;
    } else if (character === quote) {
      return index + 1;
    } else if (character === "\n" && quote !== "`") {
      return index;
    } else {
      index += 1;
    }
  }
  return source.length;
};

const endOfCharactersWhere = (source: string, start: number, belongs: (index: number) => boolean): number => {
  let index = start;
  while (index < source.length && belongs(index)) {
    index += 1;
  }
  return index;
};

const endOfNumber = (source: string, start: number): number =>
  endOfCharactersWhere(
    source,
    start,
    (index) =>
      isIdentifierPart(source.charAt(index)) ||
      (source.charAt(index) === "." && isDigit(source.charAt(index + 1))),
  );

const tokenize = (source: string, syntax: LanguageSyntax): SourceToken[] => {
  const tokens: SourceToken[] = [];
  const push = (kind: TokenKind, start: number, end: number) =>
    tokens.push({ kind, text: source.slice(start, end), start, end });
  let index = 0;
  while (index < source.length) {
    const character = source.charAt(index);
    const commentEnd = endOfComment(source, index, syntax);
    let end: number;
    if (isWhitespace(character)) {
      end = index + 1;
    } else if (commentEnd !== undefined) {
      end = commentEnd;
    } else if (quotes.has(character)) {
      end = endOfStringLiteral(source, index);
      push("string", index, end);
    } else if (isIdentifierStart(character)) {
      end = endOfCharactersWhere(source, index, (position) => isIdentifierPart(source.charAt(position)));
      push("identifier", index, end);
    } else if (isDigit(character)) {
      end = endOfNumber(source, index);
      push("number", index, end);
    } else {
      end = index + 1;
      push("punctuation", index, end);
    }
    index = end;
  }
  return tokens;
};

type MatchedGroups = { closerIndex: Int32Array; openerIndex: Int32Array };

const matchedGroups = (tokens: SourceToken[]): MatchedGroups => {
  const closerIndex = new Int32Array(tokens.length).fill(-1);
  const openerIndex = new Int32Array(tokens.length).fill(-1);
  const openOpeners: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "punctuation") {
      return;
    }
    if (Object.hasOwn(closerOfOpener, token.text)) {
      openOpeners.push(index);
      return;
    }
    if (!closers.has(token.text)) {
      return;
    }
    const lowestSearched = Math.max(0, openOpeners.length - OPENERS_SEARCHED_FOR_A_CLOSER);
    for (let position = openOpeners.length - 1; position >= lowestSearched; position -= 1) {
      const opener = openOpeners[position] as number;
      if (closerOfOpener[(tokens[opener] as SourceToken).text] === token.text) {
        closerIndex[opener] = index;
        openerIndex[index] = opener;
        openOpeners.length = position;
        return;
      }
    }
  });
  return { closerIndex, openerIndex };
};

export class SourceCode {
  public readonly tokens: SourceToken[];
  private readonly syntax: LanguageSyntax;
  private readonly groups: MatchedGroups;
  private lineStarts: number[] | undefined;

  constructor(
    public readonly source: string,
    public readonly language: SourceLanguage,
  ) {
    this.syntax = languageSyntax[language];
    this.tokens = tokenize(source, this.syntax);
    this.groups = matchedGroups(this.tokens);
  }

  public token(index: number): SourceToken | undefined {
    return this.tokens[index];
  }

  public isPunctuation(index: number, text: string): boolean {
    const token = this.tokens[index];
    return token?.kind === "punctuation" && token.text === text;
  }

  public isIdentifier(index: number, text: string): boolean {
    const token = this.tokens[index];
    return token?.kind === "identifier" && token.text === text;
  }

  public openerOfLastToken(range: TokenRange, closer: string): number | undefined {
    const opener = this.groups.openerIndex[range.last] ?? -1;
    return this.isPunctuation(range.last, closer) && opener >= range.first ? opener : undefined;
  }

  public firstTopLevelIndex(range: TokenRange, isWanted: (index: number) => boolean): number | undefined {
    let index = range.first;
    while (index <= range.last) {
      if (isWanted(index)) {
        return index;
      }
      index = (this.closerOf(index) ?? index) + 1;
    }
    return undefined;
  }

  public closerOf(openerIndex: number): number | undefined {
    const closer = this.groups.closerIndex[openerIndex] ?? -1;
    return closer === -1 ? undefined : closer;
  }

  public textOf(range: TokenRange): string {
    const first = this.tokens[range.first] as SourceToken;
    const last = this.tokens[range.last] as SourceToken;
    return this.source.slice(first.start, last.end);
  }

  public commaSeparatedItems(openerIndex: number): TokenRange[] | undefined {
    const closer = this.closerOf(openerIndex);
    if (closer === undefined) {
      return undefined;
    }
    const items: TokenRange[] = [];
    let itemStart = openerIndex + 1;
    let angleBracketDepth = 0;
    let index = openerIndex + 1;
    while (index < closer) {
      const token = this.tokens[index] as SourceToken;
      if (token.kind === "punctuation") {
        if (token.text === "," && angleBracketDepth === 0) {
          items.push({ first: itemStart, last: index - 1 });
          itemStart = index + 1;
        } else if (this.opensTypeArguments(index)) {
          angleBracketDepth += 1;
        } else if (token.text === ">" && angleBracketDepth > 0) {
          angleBracketDepth -= 1;
        }
      }
      index = (this.closerOf(index) ?? index) + 1;
    }
    if (itemStart < closer) {
      items.push({ first: itemStart, last: closer - 1 });
    }
    return items;
  }

  public lineOf(tokenIndex: number): number {
    const offset = (this.tokens[tokenIndex] as SourceToken).start;
    const lineStarts = this.knownLineStarts();
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((lineStarts[middle] as number) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  }

  public startsLine(tokenIndex: number): boolean {
    const token = this.tokens[tokenIndex];
    const previous = this.tokens[tokenIndex - 1];
    return (
      token !== undefined &&
      (previous === undefined || this.source.slice(previous.end, token.start).includes("\n"))
    );
  }

  public characterAfter(tokenIndex: number): string {
    const token = this.tokens[tokenIndex];
    return token === undefined ? "" : this.source.charAt(token.end);
  }

  public opensTypeArguments(index: number): boolean {
    const previous = this.tokens[index - 1];
    const current = this.tokens[index];
    return (
      this.syntax.angleBracketGenerics &&
      current?.kind === "punctuation" &&
      current.text === "<" &&
      previous?.kind === "identifier" &&
      previous.end === current.start
    );
  }

  private knownLineStarts(): number[] {
    if (this.lineStarts === undefined) {
      const lineStarts = [0];
      for (let index = 0; index < this.source.length; index += 1) {
        if (this.source.charAt(index) === "\n") {
          lineStarts.push(index + 1);
        }
      }
      this.lineStarts = lineStarts;
    }
    return this.lineStarts;
  }
}
