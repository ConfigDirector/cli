import type { SourceLanguage } from "./source-languages.js";
import type { SourceCode, TokenRange } from "./source-code.js";

type MapEntry = { key: TokenRange; keyIsName: boolean; value: TokenRange | undefined };

type MapLiteralEntries = (code: SourceCode, range: TokenRange) => MapEntry[] | undefined;

const KOTLIN_MAP_BUILDERS = new Set(["mapOf", "mutableMapOf", "hashMapOf", "linkedMapOf"]);

const itemsOfGroup = (code: SourceCode, opener: number | undefined): TokenRange[] | undefined =>
  opener === undefined ? undefined : code.commaSeparatedItems(opener);

const splitAt = (item: TokenRange, separator: number | undefined): MapEntry => {
  if (separator === undefined || separator === item.first || separator === item.last) {
    return { key: item, keyIsName: false, value: undefined };
  }
  return {
    key: { first: item.first, last: separator - 1 },
    keyIsName: false,
    value: { first: separator + 1, last: item.last },
  };
};

const entriesSeparatedByColon = (code: SourceCode, items: TokenRange[]): MapEntry[] =>
  items.map((item) =>
    splitAt(
      item,
      code.firstTopLevelIndex(item, (index) => code.isPunctuation(index, ":")),
    ),
  );

const entriesInClosingBraces: MapLiteralEntries = (code, range) => {
  const items = itemsOfGroup(code, code.openerOfLastToken(range, "}"));
  return items === undefined ? undefined : entriesSeparatedByColon(code, items);
};

const javascriptEntry = (code: SourceCode, item: TokenRange): MapEntry => {
  const first = code.token(item.first);
  const isShorthand = item.first === item.last && first?.kind === "identifier";
  if (isShorthand) {
    return { key: item, keyIsName: true, value: item };
  }
  const entry = splitAt(
    item,
    code.firstTopLevelIndex(item, (index) => code.isPunctuation(index, ":")),
  );
  return { ...entry, keyIsName: entry.key.first === entry.key.last && first?.kind === "identifier" };
};

const kotlinMapBuilderOpener = (code: SourceCode, range: TokenRange): number | undefined => {
  const opener = code.openerOfLastToken(range, ")");
  const builder = code.token(range.first);
  return opener !== undefined && builder?.kind === "identifier" && KOTLIN_MAP_BUILDERS.has(builder.text)
    ? opener
    : undefined;
};

const javaMapOfOpener = (code: SourceCode, range: TokenRange): number | undefined =>
  code.isIdentifier(range.first, "Map") &&
  code.isPunctuation(range.first + 1, ".") &&
  code.isIdentifier(range.first + 2, "of") &&
  code.openerOfLastToken(range, ")") === range.first + 3
    ? range.first + 3
    : undefined;

const alternatingEntries = (items: TokenRange[]): MapEntry[] =>
  items.flatMap((item, position) =>
    position % 2 === 0 ? [{ key: item, keyIsName: false, value: items[position + 1] }] : [],
  );

const csharpEntry = (code: SourceCode, item: TokenRange): MapEntry => {
  const indexerCloser = code.isPunctuation(item.first, "[") ? code.closerOf(item.first) : undefined;
  if (indexerCloser !== undefined && code.isPunctuation(indexerCloser + 1, "=")) {
    return {
      key: { first: item.first + 1, last: indexerCloser - 1 },
      keyIsName: false,
      value: { first: indexerCloser + 2, last: item.last },
    };
  }
  const pair = code.isPunctuation(item.first, "{") ? itemsOfGroup(code, item.first) : undefined;
  const [key, value] = pair ?? [];
  return key === undefined
    ? { key: item, keyIsName: false, value: undefined }
    : { key, keyIsName: false, value };
};

export const mapLiteralEntries: { [L in SourceLanguage]: MapLiteralEntries } = {
  javascript: (code, range) =>
    code.openerOfLastToken(range, "}") === range.first
      ? itemsOfGroup(code, range.first)?.map((item) => javascriptEntry(code, item))
      : undefined,
  python: (code, range) =>
    code.openerOfLastToken(range, "}") === range.first
      ? entriesSeparatedByColon(code, itemsOfGroup(code, range.first) ?? [])
      : undefined,
  dart: entriesInClosingBraces,
  swift: (code, range) =>
    code.openerOfLastToken(range, "]") === range.first
      ? entriesSeparatedByColon(
          code,
          (itemsOfGroup(code, range.first) ?? []).filter((item) => !code.isPunctuation(item.first, ":")),
        )
      : undefined,
  go: entriesInClosingBraces,
  kotlin: (code, range) =>
    itemsOfGroup(code, kotlinMapBuilderOpener(code, range))?.map((item) =>
      splitAt(
        item,
        code.firstTopLevelIndex(item, (index) => code.isIdentifier(index, "to")),
      ),
    ),
  java: (code, range) => {
    const items = itemsOfGroup(code, javaMapOfOpener(code, range));
    return items === undefined ? undefined : alternatingEntries(items);
  },
  csharp: (code, range) =>
    itemsOfGroup(code, code.openerOfLastToken(range, "}"))?.map((item) => csharpEntry(code, item)),
};
