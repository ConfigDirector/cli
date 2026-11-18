export type SourceLanguage =
  "javascript" | "dart" | "swift" | "kotlin" | "java" | "python" | "csharp" | "go" | "php" | "ruby";

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
  ".rb": "ruby",
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
  | "php"
  | "ruby";

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
  ".rb": "ruby",
};

export type LanguageSyntax = {
  lineComments: readonly ("//" | "#")[];
  blockComments: boolean;
  beginEndBlockComments: boolean;
  hashBracketOpensAttribute: boolean;
  heredocs: "php" | "ruby" | undefined;
  percentLiterals: boolean;
  stringInterpolationOpener: "#{" | undefined;
  parenthesesOptionalInCalls: boolean;
  labelsWithOmittedValues: boolean;
  symbolOpener: ":" | undefined;
  methodDefinitionKeyword: "def" | undefined;
  stringFreezingMethod: "freeze" | undefined;
  angleBracketGenerics: boolean;
  operatorsReadAsOneToken: readonly string[];
  memberAccessOperator: "." | "->";
  pathSeparators: readonly string[];
  globalNamespacePrefix: "\\" | "::" | undefined;
  enumValueAccessor: "rawValue" | "value" | undefined;
};

export const languageSyntax: { [L in SourceLanguage]: LanguageSyntax } = {
  javascript: {
    lineComments: ["//"],
    blockComments: true,
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: false,
    heredocs: undefined,
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
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
    beginEndBlockComments: false,
    hashBracketOpensAttribute: true,
    heredocs: "php",
    percentLiterals: false,
    stringInterpolationOpener: undefined,
    parenthesesOptionalInCalls: false,
    labelsWithOmittedValues: false,
    symbolOpener: undefined,
    methodDefinitionKeyword: undefined,
    stringFreezingMethod: undefined,
    angleBracketGenerics: false,
    operatorsReadAsOneToken: ["::", "->", "=>"],
    memberAccessOperator: "->",
    pathSeparators: ["::", "->", "\\"],
    globalNamespacePrefix: "\\",
    enumValueAccessor: "value",
  },
  ruby: {
    lineComments: ["#"],
    blockComments: false,
    beginEndBlockComments: true,
    hashBracketOpensAttribute: false,
    heredocs: "ruby",
    percentLiterals: true,
    stringInterpolationOpener: "#{",
    parenthesesOptionalInCalls: true,
    labelsWithOmittedValues: true,
    symbolOpener: ":",
    methodDefinitionKeyword: "def",
    stringFreezingMethod: "freeze",
    angleBracketGenerics: false,
    operatorsReadAsOneToken: ["::", "=>"],
    memberAccessOperator: ".",
    pathSeparators: [".", "::"],
    globalNamespacePrefix: "::",
    enumValueAccessor: undefined,
  },
};
