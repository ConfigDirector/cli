export type SourceLanguage = "javascript" | "dart" | "swift" | "kotlin" | "java" | "python" | "csharp" | "go";

export const languageOfExtension = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "javascript",
  ".tsx": "javascript",
  ".mts": "javascript",
  ".cts": "javascript",
  ".vue": "javascript",
  ".svelte": "javascript",
  ".dart": "dart",
  ".swift": "swift",
  ".kt": "kotlin",
  ".java": "java",
  ".py": "python",
  ".cs": "csharp",
  ".go": "go",
} as const satisfies Record<string, SourceLanguage>;

export type SourceExtension = keyof typeof languageOfExtension;

export const isSourceExtension = (extension: string): extension is SourceExtension =>
  Object.hasOwn(languageOfExtension, extension);

export type SnippetLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "vue"
  | "svelte"
  | "dart"
  | "swift"
  | "kotlin"
  | "java"
  | "python"
  | "csharp"
  | "go";

export const snippetLanguageOfExtension: { [E in SourceExtension]: SnippetLanguage } = {
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
  ".vue": "vue",
  ".svelte": "svelte",
  ".dart": "dart",
  ".swift": "swift",
  ".kt": "kotlin",
  ".java": "java",
  ".py": "python",
  ".cs": "csharp",
  ".go": "go",
};

export type LanguageSyntax = {
  lineComment: "//" | "#";
  blockComments: boolean;
  angleBracketGenerics: boolean;
};

export const languageSyntax: { [L in SourceLanguage]: LanguageSyntax } = {
  javascript: { lineComment: "//", blockComments: true, angleBracketGenerics: true },
  dart: { lineComment: "//", blockComments: true, angleBracketGenerics: true },
  swift: { lineComment: "//", blockComments: true, angleBracketGenerics: true },
  kotlin: { lineComment: "//", blockComments: true, angleBracketGenerics: true },
  java: { lineComment: "//", blockComments: true, angleBracketGenerics: true },
  python: { lineComment: "#", blockComments: false, angleBracketGenerics: false },
  csharp: { lineComment: "//", blockComments: true, angleBracketGenerics: true },
  go: { lineComment: "//", blockComments: true, angleBracketGenerics: false },
};
