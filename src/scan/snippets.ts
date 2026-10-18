import type { ScannedFile } from "./scanned-files.js";
import { snippetLanguageOfExtension, type SnippetLanguage } from "./source-languages.js";

export type Snippet = {
  firstLine: number;
  lines: string[];
  language: SnippetLanguage;
  truncatedLines: number[];
};

export type SnippetCut = { kind: "no-snippets" } | { kind: "around-each-reference"; contextLines: number };

const MAXIMUM_LINE_LENGTH = 250;

const linesOf = (contents: string): string[] => {
  const lines = contents.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

const withoutCarriageReturn = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

const snippetOfLines = (
  fileLines: readonly string[],
  line: number,
  contextLines: number,
  language: SnippetLanguage,
): Snippet => {
  const firstLine = Math.max(1, line - contextLines);
  const lastLine = Math.min(fileLines.length, line + contextLines);
  const lines: string[] = [];
  const truncatedLines: number[] = [];
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const text = withoutCarriageReturn(fileLines[lineNumber - 1] as string);
    if (text.length > MAXIMUM_LINE_LENGTH) {
      truncatedLines.push(lineNumber);
    }
    lines.push(text.slice(0, MAXIMUM_LINE_LENGTH));
  }
  return { firstLine, lines, language, truncatedLines };
};

export const snippetCutterFor = (
  file: ScannedFile,
  cut: SnippetCut,
): ((line: number) => Snippet | undefined) => {
  switch (cut.kind) {
    case "no-snippets":
      return () => undefined;
    case "around-each-reference": {
      let fileLines: string[] | undefined;
      return (line) => {
        fileLines ??= linesOf(file.contents);
        return snippetOfLines(fileLines, line, cut.contextLines, snippetLanguageOfExtension[file.extension]);
      };
    }
  }
};
