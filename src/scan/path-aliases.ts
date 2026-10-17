import { dirname, join, resolve } from "node:path";
import * as v from "valibot";
import { fileExists, parseJson } from "../file-contents.js";
import { NearestDeclarations } from "./nearest-declarations.js";
import { readFileWithinSizeLimit } from "./scanned-files.js";
import { SourceCode } from "./source-code.js";

type PathPattern =
  | { kind: "exact"; key: string; targets: readonly string[] }
  | { kind: "wildcard"; prefix: string; suffix: string; targets: readonly string[] };

type PathMapping = { patterns: PathPattern[]; targetDirectory: string };

type PathsOption = { targetsOfPattern: Readonly<Record<string, readonly string[]>>; configDirectory: string };

type AliasOptions = { paths: PathsOption | undefined; baseUrl: string | undefined };

type TypeScriptConfig = {
  aliasOptions: AliasOptions;
  extendedConfigFiles: string[];
  referencedConfigFiles: string[];
};

type AliasRules = { pathMapping: PathMapping | undefined; baseUrl: string | undefined };

type AliasMatch = { rank: number; targets: readonly string[] };

const WILDCARD = "*";
const EXACT_MATCH_RANK = Number.POSITIVE_INFINITY;
const JSON_EXTENSION = ".json";
const BYTE_ORDER_MARK = "\uFEFF";
const TYPESCRIPT_CONFIG_FILE = "tsconfig.json";
const CONFIG_FILE_NAMES = [TYPESCRIPT_CONFIG_FILE, "jsconfig.json"];
const NO_ALIAS_OPTIONS: AliasOptions = { paths: undefined, baseUrl: undefined };

const TypeScriptConfigSchema = v.object({
  extends: v.optional(v.union([v.string(), v.array(v.string())])),
  compilerOptions: v.optional(
    v.object({
      baseUrl: v.optional(v.string()),
      paths: v.optional(v.record(v.string(), v.array(v.string()))),
    }),
  ),
  references: v.optional(v.array(v.object({ path: v.string() }))),
});

const pathPatternsOf = (targetsOfPattern: Readonly<Record<string, readonly string[]>>): PathPattern[] =>
  Object.entries(targetsOfPattern).flatMap(([key, targets]): PathPattern[] => {
    const wildcard = key.indexOf(WILDCARD);
    if (wildcard === -1) {
      return [{ kind: "exact", key, targets }];
    }
    return key.includes(WILDCARD, wildcard + 1)
      ? []
      : [{ kind: "wildcard", prefix: key.slice(0, wildcard), suffix: key.slice(wildcard + 1), targets }];
  });

const aliasMatchOf = (pattern: PathPattern, specifier: string): AliasMatch | undefined => {
  switch (pattern.kind) {
    case "exact":
      return specifier === pattern.key ? { rank: EXACT_MATCH_RANK, targets: pattern.targets } : undefined;
    case "wildcard": {
      const fits =
        specifier.length >= pattern.prefix.length + pattern.suffix.length &&
        specifier.startsWith(pattern.prefix) &&
        specifier.endsWith(pattern.suffix);
      const wildcardText = specifier.slice(pattern.prefix.length, specifier.length - pattern.suffix.length);
      return fits
        ? {
            rank: pattern.prefix.length,
            targets: pattern.targets.map((target) => target.replace(WILDCARD, () => wildcardText)),
          }
        : undefined;
    }
  }
};

const bestAliasMatch = (patterns: readonly PathPattern[], specifier: string): AliasMatch | undefined =>
  patterns.reduce<AliasMatch | undefined>((best, pattern) => {
    const match = aliasMatchOf(pattern, specifier);
    return match !== undefined && (best === undefined || match.rank > best.rank) ? match : best;
  }, undefined);

const mappedModulePaths = (pathMapping: PathMapping, specifier: string): string[] | undefined =>
  bestAliasMatch(pathMapping.patterns, specifier)?.targets.map((target) =>
    resolve(pathMapping.targetDirectory, target),
  );

const modulePathsIn = ({ pathMapping, baseUrl }: AliasRules, specifier: string): string[] => {
  const mappedPaths = pathMapping === undefined ? undefined : mappedModulePaths(pathMapping, specifier);
  if (mappedPaths !== undefined) {
    return mappedPaths;
  }
  return baseUrl === undefined ? [] : [resolve(baseUrl, specifier)];
};

const isTrailingComma = (code: SourceCode, index: number) =>
  code.isPunctuation(index, ",") &&
  (code.isPunctuation(index + 1, "}") || code.isPunctuation(index + 1, "]"));

const jsonOfConfigFile = (contents: string): string => {
  const source = contents.startsWith(BYTE_ORDER_MARK) ? contents.slice(BYTE_ORDER_MARK.length) : contents;
  const code = new SourceCode(source, "javascript");
  return code.tokens
    .map((token, index) => {
      const blankBefore = " ".repeat(token.start - (code.token(index - 1)?.end ?? 0));
      return blankBefore + (isTrailingComma(code, index) ? " " : token.text);
    })
    .join("");
};

const isRelativeConfigPath = (path: string) => path.startsWith("./") || path.startsWith("../");

const extendedConfigFileAt = async (path: string): Promise<string> =>
  (await fileExists(path)) || path.endsWith(JSON_EXTENSION) ? path : `${path}${JSON_EXTENSION}`;

const referencedConfigFileAt = (path: string): string =>
  path.endsWith(JSON_EXTENSION) ? path : join(path, TYPESCRIPT_CONFIG_FILE);

const typeScriptConfigAt = async (configFile: string): Promise<TypeScriptConfig> => {
  const contents = await readFileWithinSizeLimit(configFile);
  const config = v.safeParse(
    TypeScriptConfigSchema,
    contents === undefined ? undefined : parseJson(jsonOfConfigFile(contents)),
  );
  if (!config.success) {
    return { aliasOptions: NO_ALIAS_OPTIONS, extendedConfigFiles: [], referencedConfigFiles: [] };
  }
  const { compilerOptions, extends: extendedConfigs, references } = config.output;
  const configDirectory = dirname(configFile);
  const relativeExtendedConfigs = [extendedConfigs ?? []].flat().filter(isRelativeConfigPath);
  return {
    aliasOptions: {
      paths:
        compilerOptions?.paths === undefined
          ? undefined
          : { targetsOfPattern: compilerOptions.paths, configDirectory },
      baseUrl:
        compilerOptions?.baseUrl === undefined
          ? undefined
          : resolve(configDirectory, compilerOptions.baseUrl),
    },
    extendedConfigFiles: await Promise.all(
      relativeExtendedConfigs.map((extendedConfig) =>
        extendedConfigFileAt(resolve(configDirectory, extendedConfig)),
      ),
    ),
    referencedConfigFiles: (references ?? []).map((reference) =>
      referencedConfigFileAt(resolve(configDirectory, reference.path)),
    ),
  };
};

const ownOrInherited = (own: AliasOptions, inherited: AliasOptions): AliasOptions => ({
  paths: own.paths ?? inherited.paths,
  baseUrl: own.baseUrl ?? inherited.baseUrl,
});

const declaresAliases = (aliasOptions: AliasOptions) =>
  aliasOptions.paths !== undefined || aliasOptions.baseUrl !== undefined;

const aliasRulesOf = ({ paths, baseUrl }: AliasOptions): AliasRules => ({
  pathMapping:
    paths === undefined
      ? undefined
      : {
          patterns: pathPatternsOf(paths.targetsOfPattern),
          targetDirectory: baseUrl ?? paths.configDirectory,
        },
  baseUrl,
});

class TypeScriptConfigs {
  private readonly configOfFile = new Map<string, Promise<TypeScriptConfig>>();
  private readonly aliasOptionsOfFile = new Map<string, AliasOptions>();

  public configAt(configFile: string): Promise<TypeScriptConfig> {
    const configReadBefore = this.configOfFile.get(configFile);
    if (configReadBefore !== undefined) {
      return configReadBefore;
    }
    const config = typeScriptConfigAt(configFile);
    this.configOfFile.set(configFile, config);
    return config;
  }

  public async aliasOptionsAt(
    configFile: string,
    configFilesExtending: ReadonlySet<string> = new Set(),
  ): Promise<AliasOptions> {
    const aliasOptionsReadBefore = this.aliasOptionsOfFile.get(configFile);
    if (aliasOptionsReadBefore !== undefined) {
      return aliasOptionsReadBefore;
    }
    const config = await this.configAt(configFile);
    const extendsChain = new Set([...configFilesExtending, configFile]);
    let inherited = NO_ALIAS_OPTIONS;
    for (const extendedConfigFile of config.extendedConfigFiles) {
      if (!extendsChain.has(extendedConfigFile)) {
        inherited = ownOrInherited(await this.aliasOptionsAt(extendedConfigFile, extendsChain), inherited);
      }
    }
    const aliasOptions = ownOrInherited(config.aliasOptions, inherited);
    this.aliasOptionsOfFile.set(configFile, aliasOptions);
    return aliasOptions;
  }
}

const configFileIn = async (directory: string): Promise<string | undefined> => {
  for (const configFileName of CONFIG_FILE_NAMES) {
    const configFile = join(directory, configFileName);
    if (await fileExists(configFile)) {
      return configFile;
    }
  }
  return undefined;
};

const aliasRulesDeclaredIn = async (directory: string): Promise<AliasRules[] | undefined> => {
  const configFile = await configFileIn(directory);
  if (configFile === undefined) {
    return undefined;
  }
  const configs = new TypeScriptConfigs();
  const aliasOptions = await configs.aliasOptionsAt(configFile);
  if (declaresAliases(aliasOptions)) {
    return [aliasRulesOf(aliasOptions)];
  }
  const { referencedConfigFiles } = await configs.configAt(configFile);
  return Promise.all(
    referencedConfigFiles.map(async (referencedConfigFile): Promise<AliasRules> => {
      const { pathMapping } = aliasRulesOf(await configs.aliasOptionsAt(referencedConfigFile));
      return { pathMapping, baseUrl: undefined };
    }),
  );
};

export class PathAliases {
  private readonly aliasRules: NearestDeclarations<AliasRules[]>;

  constructor(highestDirectory: string) {
    this.aliasRules = new NearestDeclarations(highestDirectory, aliasRulesDeclaredIn);
  }

  public async modulePathsFor(specifier: string, importingFile: string): Promise<string[]> {
    const aliasRules = (await this.aliasRules.declarationAbove(importingFile)) ?? [];
    const modulePathsOfFirstMatch = aliasRules
      .map((rules) => modulePathsIn(rules, specifier))
      .find((modulePaths) => modulePaths.length > 0);
    return modulePathsOfFirstMatch ?? [];
  }
}
