import { languageSyntax, type LanguageSyntax, type SourceLanguage } from "./source-languages.js";

type SourceToken =
  | { kind: "string"; text: string; start: number; end: number; plainContent: string | undefined }
  | { kind: "identifier" | "number" | "punctuation"; text: string; start: number; end: number };

export type TokenRange = { first: number; last: number };

type PercentLiteralType = "q" | "Q" | "w" | "W" | "i" | "I" | "r" | "s" | "x";

type PercentLiteralContent = "text" | "interpolatedText" | "words" | "unread";

type PercentLiteral = {
  content: PercentLiteralContent;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
};

type RubyHeredoc = { openerEnd: number; label: string; terminatorMayBeIndented: boolean };

type RubyHeredocTerminatorLineEnds = {
  ofIndentedLabel: Map<string, number[]>;
  ofLabelAtLineStart: Map<string, number[]>;
};

type CharacterRange = { start: number; end: number };

const closerOfOpener: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const closers = new Set(Object.values(closerOfOpener));
const quotes = new Set(['"', "'", "`"]);
const interpolatingQuotes = new Set(['"', "`"]);
const ATTRIBUTE_OPENER = "#[";
const PHP_HEREDOC_OPENER = "<<<";
const PHP_HEREDOC_LABEL_QUOTES = new Set(['"', "'"]);
const RUBY_HEREDOC_OPENER = "<<";
const RUBY_HEREDOC_MARKERS_OF_AN_INDENTED_TERMINATOR = new Set(["~", "-"]);
const RUBY_HEREDOC_LABEL_QUOTES = new Set(['"', "'", "`"]);
const BEGIN_END_COMMENT_OPENER = "=begin";
const BEGIN_END_COMMENT_CLOSER = "=end";
const PERCENT_LITERAL_OPENER = "%";
const percentLiteralContentOfType: { [T in PercentLiteralType]: PercentLiteralContent } = {
  q: "text",
  Q: "interpolatedText",
  w: "words",
  W: "words",
  i: "words",
  I: "words",
  r: "unread",
  s: "unread",
  x: "unread",
};
const CONTENT_OF_A_PERCENT_LITERAL_WITHOUT_TYPE: PercentLiteralContent = "interpolatedText";
const closerOfPercentLiteralDelimiter: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
};
const PUNCTUATION_ENDING_A_VALUE = new Set([")", "]", "}"]);
const OPENERS_SEARCHED_FOR_A_CLOSER = 8;
const INTERPOLATIONS_READ_INSIDE_EACH_OTHER = 8;

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

const startsLineAt = (source: string, index: number) => index === 0 || source.charAt(index - 1) === "\n";

const endsWordAt = (source: string, index: number) =>
  index >= source.length || isWhitespace(source.charAt(index));

const endOfCharactersWhere = (source: string, start: number, belongs: (index: number) => boolean): number => {
  let index = start;
  while (index < source.length && belongs(index)) {
    index += 1;
  }
  return index;
};

const opensLineComment = (source: string, start: number, syntax: LanguageSyntax): boolean =>
  syntax.lineComments.some((marker) => source.startsWith(marker, start)) &&
  !(syntax.hashBracketOpensAttribute && source.startsWith(ATTRIBUTE_OPENER, start));

const opensBeginEndComment = (source: string, start: number, syntax: LanguageSyntax): boolean =>
  syntax.beginEndBlockComments &&
  startsLineAt(source, start) &&
  source.startsWith(BEGIN_END_COMMENT_OPENER, start) &&
  endsWordAt(source, start + BEGIN_END_COMMENT_OPENER.length);

const endOfBeginEndComment = (source: string, start: number): number => {
  for (
    let lineStart = endOfLine(source, start) + 1;
    lineStart < source.length;
    lineStart = endOfLine(source, lineStart) + 1
  ) {
    if (
      source.startsWith(BEGIN_END_COMMENT_CLOSER, lineStart) &&
      endsWordAt(source, lineStart + BEGIN_END_COMMENT_CLOSER.length)
    ) {
      return endOfLine(source, lineStart);
    }
  }
  return source.length;
};

const endOfComment = (source: string, start: number, syntax: LanguageSyntax): number | undefined => {
  if (opensLineComment(source, start, syntax)) {
    return endOfLine(source, start);
  }
  if (syntax.blockComments && source.startsWith("/*", start)) {
    const close = source.indexOf("*/", start + 2);
    return close === -1 ? source.length : close + 2;
  }
  if (opensBeginEndComment(source, start, syntax)) {
    return endOfBeginEndComment(source, start);
  }
  return undefined;
};

const plainContentOf = (content: string, interpolationOpener: string | undefined): string | undefined =>
  content.includes("\\") ||
  content.includes("$") ||
  (interpolationOpener !== undefined && content.includes(interpolationOpener))
    ? undefined
    : content;

const interpolationOpenerOf = (quote: string, syntax: LanguageSyntax): string | undefined =>
  interpolatingQuotes.has(quote) ? syntax.stringInterpolationOpener : undefined;

const plainContentOfQuotedString = (text: string, syntax: LanguageSyntax): string | undefined => {
  const quote = text.charAt(0);
  const content = text.slice(1, -1);
  const isOneQuotedString = text.length >= 2 && text.endsWith(quote) && !content.includes(quote);
  return isOneQuotedString ? plainContentOf(content, interpolationOpenerOf(quote, syntax)) : undefined;
};

function endOfStringLiteral(
  source: string,
  start: number,
  syntax: LanguageSyntax,
  interpolationsAround: number,
): number {
  const quote = source.charAt(start);
  const tripleQuote = quote.repeat(3);
  if (quote !== "`" && source.startsWith(tripleQuote, start)) {
    const close = source.indexOf(tripleQuote, start + 3);
    return close === -1 ? source.length : close + 3;
  }
  const interpolationOpener =
    interpolationsAround < INTERPOLATIONS_READ_INSIDE_EACH_OTHER
      ? interpolationOpenerOf(quote, syntax)
      : undefined;
  let index = start + 1;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 2;
    } else if (character === quote) {
      return index + 1;
    } else if (character === "\n" && quote !== "`") {
      return index;
    } else if (interpolationOpener !== undefined && source.startsWith(interpolationOpener, index)) {
      index = endOfInterpolation(
        source,
        index + interpolationOpener.length,
        syntax,
        interpolationsAround + 1,
      );
    } else {
      index += 1;
    }
  }
  return source.length;
}

function endOfInterpolation(
  source: string,
  start: number,
  syntax: LanguageSyntax,
  interpolationsAround: number,
): number {
  let openBraces = 1;
  let index = start;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\n") {
      return index;
    }
    if (quotes.has(character)) {
      index = endOfStringLiteral(source, index, syntax, interpolationsAround);
    } else {
      if (character === "{") {
        openBraces += 1;
      } else if (character === "}") {
        openBraces -= 1;
        if (openBraces === 0) {
          return index + 1;
        }
      }
      index += 1;
    }
  }
  return index;
}

const isHeredocLabelStart = (character: string) =>
  isAsciiLetter(character) || character === "_" || character > "\u007f";

const isHeredocLabelPart = (character: string) => isHeredocLabelStart(character) || isDigit(character);

const isSpaceOrTab = (character: string) => character === " " || character === "\t";

const startsLineBreak = (source: string, index: number) =>
  source.charAt(index) === "\n" || source.startsWith("\r\n", index);

const phpHeredocLabelOpenedAt = (source: string, start: number): string | undefined => {
  if (!source.startsWith(PHP_HEREDOC_OPENER, start)) {
    return undefined;
  }
  const labelOrQuote = endOfCharactersWhere(source, start + PHP_HEREDOC_OPENER.length, (index) =>
    isSpaceOrTab(source.charAt(index)),
  );
  const isQuoted = PHP_HEREDOC_LABEL_QUOTES.has(source.charAt(labelOrQuote));
  const labelStart = isQuoted ? labelOrQuote + 1 : labelOrQuote;
  const labelEnd = endOfCharactersWhere(source, labelStart, (index) =>
    isHeredocLabelPart(source.charAt(index)),
  );
  const headerEnd = isQuoted ? labelEnd + 1 : labelEnd;
  const opensHeredoc = isHeredocLabelStart(source.charAt(labelStart)) && startsLineBreak(source, headerEnd);
  return opensHeredoc ? source.slice(labelStart, labelEnd) : undefined;
};

const endOfPhpHeredocBody = (source: string, start: number, label: string): number => {
  let lineStart = source.indexOf("\n", start) + 1;
  while (lineStart > 0) {
    const labelStart = endOfCharactersWhere(source, lineStart, (index) => isSpaceOrTab(source.charAt(index)));
    const labelEnd = labelStart + label.length;
    if (source.startsWith(label, labelStart) && !isHeredocLabelPart(source.charAt(labelEnd))) {
      return labelEnd;
    }
    lineStart = source.indexOf("\n", lineStart) + 1;
  }
  return source.length;
};

const endOfPhpHeredoc = (source: string, start: number): number | undefined => {
  const label = phpHeredocLabelOpenedAt(source, start);
  return label === undefined ? undefined : endOfPhpHeredocBody(source, start, label);
};

const rubyHeredocAt = (source: string, start: number): RubyHeredoc | undefined => {
  if (!source.startsWith(RUBY_HEREDOC_OPENER, start)) {
    return undefined;
  }
  const afterOpener = start + RUBY_HEREDOC_OPENER.length;
  const terminatorMayBeIndented = RUBY_HEREDOC_MARKERS_OF_AN_INDENTED_TERMINATOR.has(
    source.charAt(afterOpener),
  );
  const labelStart = terminatorMayBeIndented ? afterOpener + 1 : afterOpener;
  const quote = source.charAt(labelStart);
  if (RUBY_HEREDOC_LABEL_QUOTES.has(quote)) {
    const closingQuote = source.indexOf(quote, labelStart + 1);
    const label = closingQuote === -1 ? "" : source.slice(labelStart + 1, closingQuote);
    return label === "" || label.includes("\n")
      ? undefined
      : { openerEnd: closingQuote + 1, label, terminatorMayBeIndented };
  }
  if (!isHeredocLabelStart(quote)) {
    return undefined;
  }
  const labelEnd = endOfCharactersWhere(source, labelStart, (index) =>
    isHeredocLabelPart(source.charAt(index)),
  );
  return { openerEnd: labelEnd, label: source.slice(labelStart, labelEnd), terminatorMayBeIndented };
};

const addLineEnd = (lineEndsOfLabel: Map<string, number[]>, label: string, lineEnd: number) => {
  const lineEnds = lineEndsOfLabel.get(label);
  if (lineEnds === undefined) {
    lineEndsOfLabel.set(label, [lineEnd]);
  } else {
    lineEnds.push(lineEnd);
  }
};

const rubyHeredocTerminatorLineEndsIn = (source: string): RubyHeredocTerminatorLineEnds => {
  const terminatorLineEnds: RubyHeredocTerminatorLineEnds = {
    ofIndentedLabel: new Map(),
    ofLabelAtLineStart: new Map(),
  };
  for (let lineStart = 0; lineStart < source.length; lineStart = endOfLine(source, lineStart) + 1) {
    const lineEnd = endOfLine(source, lineStart);
    const indentationEnd = endOfCharactersWhere(
      source,
      lineStart,
      (index) => index < lineEnd && isSpaceOrTab(source.charAt(index)),
    );
    addLineEnd(terminatorLineEnds.ofLabelAtLineStart, source.slice(lineStart, lineEnd).trimEnd(), lineEnd);
    addLineEnd(terminatorLineEnds.ofIndentedLabel, source.slice(indentationEnd, lineEnd).trimEnd(), lineEnd);
  }
  return terminatorLineEnds;
};

const firstAtOrAfter = (ascendingPositions: readonly number[], position: number): number | undefined => {
  let low = 0;
  let high = ascendingPositions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((ascendingPositions[middle] as number) < position) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return ascendingPositions[low];
};

const closersOfDelimiterOpeners = (source: string, opener: string, closer: string): Map<number, number> => {
  const closerOfOpener = new Map<number, number>();
  const unclosedOpeners: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 1;
    } else if (character === opener) {
      unclosedOpeners.push(index);
    } else if (character === closer) {
      const openerIndex = unclosedOpeners.pop();
      if (openerIndex !== undefined) {
        closerOfOpener.set(openerIndex, index);
      }
    }
  }
  return closerOfOpener;
};

const indexOfDelimiterAfter = (source: string, start: number, delimiter: string): number | undefined => {
  for (let index = start; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 1;
    } else if (character === delimiter) {
      return index;
    }
  }
  return undefined;
};

const opensPercentLiteralAfter = (previous: SourceToken | undefined, start: number): boolean => {
  if (previous === undefined) {
    return true;
  }
  switch (previous.kind) {
    case "punctuation":
      return !PUNCTUATION_ENDING_A_VALUE.has(previous.text);
    case "identifier":
      return previous.end < start;
    case "string":
    case "number":
      return false;
  }
};

const isPercentLiteralDelimiter = (character: string) =>
  character !== "" &&
  character !== "=" &&
  character !== "\\" &&
  !isWhitespace(character) &&
  !isAsciiLetter(character) &&
  !isDigit(character);

const isPercentLiteralType = (character: string): character is PercentLiteralType =>
  Object.hasOwn(percentLiteralContentOfType, character);

const wordsBetween = (source: string, start: number, end: number): CharacterRange[] => {
  const words: CharacterRange[] = [];
  let index = start;
  while (index < end) {
    const wordStart = endOfCharactersWhere(
      source,
      index,
      (position) => position < end && isWhitespace(source.charAt(position)),
    );
    const wordEnd = endOfCharactersWhere(
      source,
      wordStart,
      (position) => position < end && !isWhitespace(source.charAt(position)),
    );
    if (wordEnd > wordStart) {
      words.push({ start: wordStart, end: wordEnd });
    }
    index = wordEnd;
  }
  return words;
};

const endOfNumber = (source: string, start: number): number =>
  endOfCharactersWhere(
    source,
    start,
    (index) =>
      isIdentifierPart(source.charAt(index)) ||
      (source.charAt(index) === "." && isDigit(source.charAt(index + 1))),
  );

const endOfPunctuation = (source: string, start: number, syntax: LanguageSyntax): number => {
  const operator = syntax.operatorsReadAsOneToken.find((candidate) => source.startsWith(candidate, start));
  return start + (operator?.length ?? 1);
};

class Tokenizer {
  private readonly tokens: SourceToken[] = [];
  private readonly closersOfPercentLiteralOpeners = new Map<string, Map<number, number>>();
  private rubyHeredocTerminatorLineEnds: RubyHeredocTerminatorLineEnds | undefined;
  private rubyHeredocBodiesEnd: number | undefined;

  constructor(
    private readonly source: string,
    private readonly syntax: LanguageSyntax,
  ) {}

  public tokenize(): SourceToken[] {
    let index = 0;
    while (index < this.source.length) {
      index = this.endOfTokenAt(index);
    }
    return this.tokens;
  }

  private endOfTokenAt(index: number): number {
    const { source, syntax } = this;
    const character = source.charAt(index);
    if (isWhitespace(character)) {
      return this.endOfWhitespaceOrHeredocBodiesAt(index);
    }
    const commentEnd = endOfComment(source, index, syntax);
    if (commentEnd !== undefined) {
      return commentEnd;
    }
    const heredocEnd = this.endOfHeredocOpenedAt(index);
    if (heredocEnd !== undefined) {
      return this.pushString(index, heredocEnd, undefined);
    }
    const percentLiteral = syntax.percentLiterals ? this.percentLiteralAt(index) : undefined;
    if (percentLiteral !== undefined) {
      return this.pushPercentLiteral(percentLiteral);
    }
    if (quotes.has(character)) {
      const end = endOfStringLiteral(source, index, syntax, 0);
      return this.pushString(index, end, plainContentOfQuotedString(source.slice(index, end), syntax));
    }
    if (isIdentifierStart(character)) {
      return this.push(
        "identifier",
        index,
        endOfCharactersWhere(source, index, (position) => isIdentifierPart(source.charAt(position))),
      );
    }
    if (isDigit(character)) {
      return this.push("number", index, endOfNumber(source, index));
    }
    return this.push("punctuation", index, endOfPunctuation(source, index, syntax));
  }

  private endOfWhitespaceOrHeredocBodiesAt(index: number): number {
    const heredocBodiesEnd = this.rubyHeredocBodiesEnd;
    if (this.source.charAt(index) !== "\n" || heredocBodiesEnd === undefined) {
      return index + 1;
    }
    this.rubyHeredocBodiesEnd = undefined;
    return heredocBodiesEnd;
  }

  private endOfHeredocOpenedAt(index: number): number | undefined {
    switch (this.syntax.heredocs) {
      case "php":
        return endOfPhpHeredoc(this.source, index);
      case "ruby":
        return this.endOfRubyHeredocOpenerAt(index);
      case undefined:
        return undefined;
    }
  }

  private endOfRubyHeredocOpenerAt(index: number): number | undefined {
    const heredoc = rubyHeredocAt(this.source, index);
    if (heredoc === undefined) {
      return undefined;
    }
    const bodyStart = (this.rubyHeredocBodiesEnd ?? endOfLine(this.source, index)) + 1;
    const terminatorLineEnds = this.rubyHeredocTerminatorLineEndsOfLabel(heredoc);
    const terminatorLineEnd =
      terminatorLineEnds === undefined ? undefined : firstAtOrAfter(terminatorLineEnds, bodyStart);
    if (terminatorLineEnd === undefined) {
      return undefined;
    }
    this.rubyHeredocBodiesEnd = terminatorLineEnd;
    return heredoc.openerEnd;
  }

  private rubyHeredocTerminatorLineEndsOfLabel({
    label,
    terminatorMayBeIndented,
  }: RubyHeredoc): number[] | undefined {
    this.rubyHeredocTerminatorLineEnds ??= rubyHeredocTerminatorLineEndsIn(this.source);
    const lineEndsOfLabel = terminatorMayBeIndented
      ? this.rubyHeredocTerminatorLineEnds.ofIndentedLabel
      : this.rubyHeredocTerminatorLineEnds.ofLabelAtLineStart;
    return lineEndsOfLabel.get(label);
  }

  private percentLiteralAt(start: number): PercentLiteral | undefined {
    const { source } = this;
    if (
      !source.startsWith(PERCENT_LITERAL_OPENER, start) ||
      !opensPercentLiteralAfter(this.tokens.at(-1), start)
    ) {
      return undefined;
    }
    const type = source.charAt(start + 1);
    const delimiterIndex = isPercentLiteralType(type) ? start + 2 : start + 1;
    const delimiter = source.charAt(delimiterIndex);
    const contentEnd = isPercentLiteralDelimiter(delimiter)
      ? this.indexOfPercentLiteralCloser(delimiterIndex, delimiter)
      : undefined;
    return contentEnd === undefined
      ? undefined
      : {
          content: isPercentLiteralType(type)
            ? percentLiteralContentOfType[type]
            : CONTENT_OF_A_PERCENT_LITERAL_WITHOUT_TYPE,
          start,
          contentStart: delimiterIndex + 1,
          contentEnd,
          end: contentEnd + 1,
        };
  }

  private indexOfPercentLiteralCloser(delimiterIndex: number, delimiter: string): number | undefined {
    const closer = closerOfPercentLiteralDelimiter[delimiter];
    if (closer === undefined) {
      return indexOfDelimiterAfter(this.source, delimiterIndex + 1, delimiter);
    }
    let closersOfOpeners = this.closersOfPercentLiteralOpeners.get(delimiter);
    if (closersOfOpeners === undefined) {
      closersOfOpeners = closersOfDelimiterOpeners(this.source, delimiter, closer);
      this.closersOfPercentLiteralOpeners.set(delimiter, closersOfOpeners);
    }
    return closersOfOpeners.get(delimiterIndex);
  }

  private pushPercentLiteral({ content, start, contentStart, contentEnd, end }: PercentLiteral): number {
    const { source, syntax } = this;
    switch (content) {
      case "text":
        this.pushString(start, end, plainContentOf(source.slice(contentStart, contentEnd), undefined));
        break;
      case "interpolatedText":
        this.pushString(
          start,
          end,
          plainContentOf(source.slice(contentStart, contentEnd), syntax.stringInterpolationOpener),
        );
        break;
      case "words":
        for (const word of wordsBetween(source, contentStart, contentEnd)) {
          this.pushString(
            word.start,
            word.end,
            plainContentOf(source.slice(word.start, word.end), undefined),
          );
        }
        break;
      case "unread":
        this.pushString(start, end, undefined);
        break;
    }
    return end;
  }

  private push(kind: "identifier" | "number" | "punctuation", start: number, end: number): number {
    this.tokens.push({ kind, text: this.source.slice(start, end), start, end });
    return end;
  }

  private pushString(start: number, end: number, plainContent: string | undefined): number {
    this.tokens.push({ kind: "string", text: this.source.slice(start, end), start, end, plainContent });
    return end;
  }
}

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
    this.tokens = new Tokenizer(source, this.syntax).tokenize();
    this.groups = matchedGroups(this.tokens);
  }

  public token(index: number): SourceToken | undefined {
    return this.tokens[index];
  }

  public isPunctuation(index: number, text: string): boolean {
    const token = this.tokens[index];
    return token?.kind === "punctuation" && token.text === text;
  }

  public areAdjacent(first: number, second: number): boolean {
    const firstToken = this.tokens[first];
    const secondToken = this.tokens[second];
    return firstToken !== undefined && secondToken !== undefined && firstToken.end === secondToken.start;
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
    return closer === undefined
      ? undefined
      : this.commaSeparatedItemsIn({ first: openerIndex + 1, last: closer - 1 });
  }

  public commaSeparatedItemsIn(range: TokenRange): TokenRange[] {
    const items: TokenRange[] = [];
    let itemStart = range.first;
    let angleBracketDepth = 0;
    let index = range.first;
    while (index <= range.last) {
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
    if (itemStart <= range.last) {
      items.push({ first: itemStart, last: range.last });
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
