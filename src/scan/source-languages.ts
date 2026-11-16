export type SourceLanguage =
  "javascript" | "dart" | "swift" | "kotlin" | "java" | "python" | "csharp" | "go" | "php";

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
  ".php": "php",
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
  | "go"
  | "php";

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
  ".php": "php",
};

export type LanguageSyntax = {
  lineComments: readonly ("//" | "#")[];
  blockComments: boolean;
  hashBracketOpensAttribute: boolean;
  heredocs: boolean;
  angleBracketGenerics: boolean;
  operatorsReadAsOneToken: readonly string[];
  memberAccessOperator: "." | "->";
  pathSeparators: readonly string[];
  globalNamespacePrefix: "\\" | undefined;
  enumValueAccessor: "rawValue" | "value" | undefined;
};

export const languageSyntax: { [L in SourceLanguage]: LanguageSyntax } = {
  javascript: {
    lineComments: ["//"],
    blockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: true,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: undefined,
  },
  dart: {
    lineComments: ["//"],
    blockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: true,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: undefined,
  },
  swift: {
    lineComments: ["//"],
    blockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: true,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: "rawValue",
  },
  kotlin: {
    lineComments: ["//"],
    blockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: true,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: undefined,
  },
  java: {
    lineComments: ["//"],
    blockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: true,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: undefined,
  },
  python: {
    lineComments: ["#"],
    blockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: false,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: undefined,
  },
  csharp: {
    lineComments: ["//"],
    blockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: true,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: undefined,
  },
  go: {
    lineComments: ["//"],
    blockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: false,
    angleBracketGenerics: false,
    operatorsReadAsOneToken: [],
    memberAccessOperator: ".",
    pathSeparators: ["."],
    globalNamespacePrefix: undefined,
    enumValueAccessor: undefined,
  },
  php: {
    lineComments: ["//", "#"],
    blockComments: true,
    hashBracketOpensAttribute: true,
    heredocs: true,
    angleBracketGenerics: false,
    operatorsReadAsOneToken: ["::", "->", "=>"],
    memberAccessOperator: "->",
    pathSeparators: ["::", "->", "\\"],
    globalNamespacePrefix: "\\",
    enumValueAccessor: "value",
  },
};
