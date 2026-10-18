import { Command, CommanderError, Option, type OptionValues } from "commander";
import { version } from "../package.json";
import { CliError } from "./CliError.js";
import type { CommandContext, CommandOutput } from "./CommandContext.js";
import { ExitCode } from "./ExitCode.js";
import { nonEmptyVariable, type Invocation } from "./Invocation.js";
import {
  archiveConfig,
  createConfig,
  getConfig,
  LIFECYCLE_STATES,
  listConfigs,
  showConfigActivity,
} from "./commands/configs.js";
import { listEnvironments } from "./commands/environments.js";
import { evaluate } from "./commands/evaluate.js";
import { init } from "./commands/init.js";
import { login } from "./commands/login.js";
import { listProjects } from "./commands/projects.js";
import { scan } from "./commands/scan.js";
import { getSegment, listSegments } from "./commands/segments.js";
import { setTargetingRules, showTargetingRulesReference } from "./commands/targeting-rules.js";
import { validate } from "./commands/validate.js";
import {
  CONFIG_LIFETIMES,
  CONFIG_ROLES,
  CONFIG_TYPES,
  ENUM_VALUE_TYPES,
  TIMESPAN_UNITS,
  typeConstraintHelpGroup,
} from "./configs/new-config.js";

const DEFAULT_BASE_URL = "https://api.configdirector.com";

type GlobalOptions = {
  token?: string;
  baseUrl?: string;
  project?: string;
  json?: boolean;
};

const withoutTrailingSlashes = (url: string): string => {
  let trimmedUrl = url;
  while (trimmedUrl.endsWith("/")) {
    trimmedUrl = trimmedUrl.slice(0, -1);
  }
  return trimmedUrl;
};

type CommandArguments = ReadonlyArray<string | undefined>;

const repeatedOption = (value: string, values: string[] | undefined): string[] => [...(values ?? []), value];

type CommandImplementation<Arguments extends CommandArguments, CommandOptions extends OptionValues> = (
  context: CommandContext,
  commandArguments: Arguments,
  commandOptions: CommandOptions,
) => Promise<CommandOutput>;

const runCommand = async <Arguments extends CommandArguments, CommandOptions extends OptionValues>(
  invocation: Invocation,
  command: CommandImplementation<Arguments, CommandOptions>,
  actionArguments: unknown[],
): Promise<ExitCode> => {
  const parsedCommand = actionArguments.at(-1) as Command;
  const options = parsedCommand.optsWithGlobals<GlobalOptions>();
  const output = await command(
    {
      invocation,
      baseUrl: withoutTrailingSlashes(
        options.baseUrl ?? nonEmptyVariable(invocation, "CONFIGDIRECTOR_BASE_URL") ?? DEFAULT_BASE_URL,
      ),
      tokenOption: options.token,
      projectSlug: options.project ?? nonEmptyVariable(invocation, "CONFIGDIRECTOR_PROJECT"),
    },
    parsedCommand.processedArgs as unknown as Arguments,
    parsedCommand.opts<CommandOptions>(),
  );
  invocation.stdout.write(options.json ? `${JSON.stringify(output.json, null, 2)}\n` : output.text);
  return output.exitCode;
};

const reportFailure = (invocation: Invocation, error: unknown): ExitCode => {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? ExitCode.success : ExitCode.couldNotRun;
  }
  if (error instanceof CliError) {
    invocation.stderr.write(`Error: ${error.message}\n`);
    return ExitCode.couldNotRun;
  }
  invocation.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  return ExitCode.couldNotRun;
};

export const run = async (invocation: Invocation): Promise<ExitCode> => {
  let exitCode: ExitCode = ExitCode.success;
  const commandAction =
    <Arguments extends CommandArguments, CommandOptions extends OptionValues>(
      command: CommandImplementation<Arguments, CommandOptions>,
    ) =>
    async (...actionArguments: unknown[]) => {
      exitCode = await runCommand(invocation, command, actionArguments);
    };

  const program = new Command("configdirector")
    .description("Work with ConfigDirector configs from the terminal and CI.")
    .addHelpText("afterAll", "\nBeta: commands and output may change before 1.0.")
    .configureHelp({ showGlobalOptions: true })
    .version(version)
    .option("--token <token>", "API token, used instead of CONFIGDIRECTOR_TOKEN and the token saved by login")
    .option(
      "--base-url <url>",
      `Admin API host, used instead of CONFIGDIRECTOR_BASE_URL (default ${DEFAULT_BASE_URL})`,
    )
    .option("--project <slug>", "project slug, used instead of CONFIGDIRECTOR_PROJECT")
    .option("--json", "print JSON on stdout")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => invocation.stdout.write(text),
      writeErr: (text) => invocation.stderr.write(text),
    });

  program
    .command("login")
    .description("save an API token for later runs, after checking it can list projects")
    .action(commandAction(login));

  program
    .command("init")
    .description("write configdirector.json for a project in the current directory")
    .action(commandAction(init));

  program
    .command("scan")
    .argument("[path]", "directory or file to scan (default: the current directory)")
    .description("list where the code reads config keys through a ConfigDirector SDK")
    .option(
      "--upload",
      "send the code references to the project, replacing those it holds for this repository",
    )
    .option(
      "--repository <name>",
      "the repository name to upload under (default: the path of the git remote origin, such as ConfigDirector/cli)",
    )
    .action(commandAction(scan));

  program
    .command("validate")
    .argument("[path]", "directory or file to check (default: the current directory)")
    .description(
      "check every config key the code reads against the project's configs, exiting 1 when one is wrong",
    )
    .action(commandAction(validate));

  program
    .command("evaluate")
    .argument("<key>", "the config's key")
    .description("show the value a context gets for a config in an environment, and why")
    .requiredOption(
      "--environment <slug>",
      "slug of the environment whose targeting rules to evaluate (required)",
    )
    .option("--context-kind <kind>", "context kind of the context to evaluate for (default: user)")
    .option("--context-id <identifier>", "identifier of the context")
    .option("--context-name <name>", "name of the context")
    .option(
      "--context-trait <name=value>",
      "a trait of the context, as a string, or name:=<json> for a number, boolean, array or object; repeatable",
      repeatedOption,
    )
    .option("--context-json <json>", "the whole context as a JSON object, or @<file> to read it from a file")
    .option(
      "--saved-context <kind:identifier>",
      "a context ConfigDirector saved from SDK evaluations in the environment, such as user:123",
    )
    .addHelpText(
      "after",
      "\nGive the context with the --context-* options, with --context-json, or with --saved-context. " +
        "Without any of them, the config is evaluated for an empty context, as an SDK given none would.",
    )
    .action(commandAction(evaluate));

  program
    .command("projects")
    .description("list the projects of the API token's organization")
    .command("list")
    .description("list the organization's projects, whatever project is selected")
    .action(commandAction(listProjects));

  program
    .command("environments")
    .description("list the project's environments")
    .command("list")
    .description("list the project's environments with their slugs, marking the live ones")
    .action(commandAction(listEnvironments));

  const configsCommand = program
    .command("configs")
    .description("list, show, create and archive a project's configs");

  configsCommand
    .command("list")
    .description("list the project's configs with their type, role, lifetime and lifecycle state")
    .option(
      "--tag <name>",
      "list only the configs that have this tag; repeatable, for configs with any of them",
      repeatedOption,
    )
    .addOption(new Option("--untagged", "list only the configs without tags").conflicts("tag"))
    .addOption(
      new Option("--state <state>", "list only the configs in this lifecycle state").choices(
        LIFECYCLE_STATES,
      ),
    )
    .action(commandAction(listConfigs));

  configsCommand
    .command("get")
    .argument("<key>", "the config's key, or an old key of it")
    .description("show a config's settings and its targeting rules in every environment")
    .action(commandAction(getConfig));

  configsCommand
    .command("activity")
    .argument("<key>", "the config's key, or an old key of it")
    .description(
      "show when SDKs last evaluated a config, per environment, SDK key kind, SDK name and SDK version",
    )
    .action(commandAction(showConfigActivity));

  configsCommand
    .command("create")
    .description("create a config from options that mirror the Admin API's fields")
    .requiredOption("--key <key>", "the config's key (required)")
    .option("--description <text>", "a description shown with the config in the dashboard")
    .addOption(
      new Option("--type <type>", "the type of the config's values (required)")
        .choices(CONFIG_TYPES)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--role <role>", "what the config is for (required)")
        .choices(CONFIG_ROLES)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--lifetime <lifetime>", "whether the config is expected to be removed (required)")
        .choices(CONFIG_LIFETIMES)
        .makeOptionMandatory(),
    )
    .requiredOption(
      "--default-value <value>",
      "the default targeting rule value every environment starts with, in the type given by --type; " +
        "not the in-code default value an application passes to the SDK (required)",
    )
    .option("--client-only", "serve the config to client SDKs only (default: client and server SDKs)")
    .addOption(
      new Option(
        "--server-only",
        "serve the config to server SDKs only (default: client and server SDKs)",
      ).conflicts("clientOnly"),
    )
    .option("--tag <name>", "assign the project's tag with this name; repeatable", repeatedOption)
    .option(
      "--variation <name=value>",
      "a variation of an experiment, its value in the type given by --type; repeatable",
      repeatedOption,
    )
    .addOption(
      new Option("--min <number>", "the smallest value allowed, included").helpGroup(
        typeConstraintHelpGroup("min"),
      ),
    )
    .addOption(
      new Option("--max <number>", "the largest value allowed, included").helpGroup(
        typeConstraintHelpGroup("max"),
      ),
    )
    .addOption(
      new Option("--exclusive-min <number>", "values must be greater than this number")
        .conflicts("min")
        .helpGroup(typeConstraintHelpGroup("exclusiveMin")),
    )
    .addOption(
      new Option("--exclusive-max <number>", "values must be less than this number")
        .conflicts("max")
        .helpGroup(typeConstraintHelpGroup("exclusiveMax")),
    )
    .addOption(
      new Option("--unit <unit>", "the unit of the number the SDKs receive (required)")
        .choices(TIMESPAN_UNITS)
        .helpGroup(typeConstraintHelpGroup("unit")),
    )
    .addOption(
      new Option("--allow-fractions", "allow values with a fraction of the unit").helpGroup(
        typeConstraintHelpGroup("allowFractions"),
      ),
    )
    .addOption(
      new Option("--allowed-value <value>", "a value the config can take; repeatable")
        .argParser(repeatedOption)
        .helpGroup(typeConstraintHelpGroup("allowedValue")),
    )
    .addOption(
      new Option(
        "--enum-value-type <type>",
        "whether the allowed values are strings or numbers (default: string)",
      )
        .choices(ENUM_VALUE_TYPES)
        .helpGroup(typeConstraintHelpGroup("enumValueType")),
    )
    .addOption(
      new Option("--https-only", "allow only HTTPS URLs").helpGroup(typeConstraintHelpGroup("httpsOnly")),
    )
    .addOption(
      new Option("--json-schema <file>", "a file holding the JSON Schema every value must match").helpGroup(
        typeConstraintHelpGroup("jsonSchema"),
      ),
    )
    .action(commandAction(createConfig));

  configsCommand
    .command("archive")
    .argument("<key>", "the config's key, or an old key of it")
    .description("archive a config, so SDKs stop receiving it; the dashboard can restore it for 30 days")
    .addHelpText(
      "after",
      "\nThe config is archived with no confirmation and no check of whether the code still reads its key, " +
        "so run configdirector scan first. Applications that still read it get their in-code default value.",
    )
    .action(commandAction(archiveConfig));

  const segmentsCommand = program
    .command("segments")
    .description("list a project's segments and show one segment");

  segmentsCommand
    .command("list")
    .description("list the project's segments with how many configs use each")
    .action(commandAction(listSegments));

  segmentsCommand
    .command("get")
    .argument("<key>", "the segment's key")
    .description("show a segment's condition groups and its environment overrides")
    .action(commandAction(getSegment));

  const targetingRulesCommand = program
    .command("targeting-rules")
    .description("replace a config's targeting rules in one environment and show the format they take");

  targetingRulesCommand
    .command("set")
    .argument("<key>", "the config's key, or an old key of it")
    .description("replace a config's targeting rules in one environment with the rules of a JSON file")
    .requiredOption(
      "--environment <slug>",
      "slug of the environment whose targeting rules to replace (required)",
    )
    .requiredOption(
      "--rules <file>",
      "a JSON file holding defaultValue and rules as the Admin API takes them, or - to read it from stdin (required)",
    )
    .addHelpText(
      "after",
      '\nThe file holds {"defaultValue": ..., "rules": [...]}, like an entry of targets in configs get --json, ' +
        "so you can edit that output and write it back. Every rule of the environment is replaced. " +
        "A rule, condition or percentage without an id gets a new one. " +
        "configdirector targeting-rules reference lists the condition kinds, attributes and operators.",
    )
    .action(commandAction(setTargetingRules));

  targetingRulesCommand
    .command("reference")
    .description(
      "show the format targeting rules take: the condition kinds, the attributes a condition can test and the operators",
    )
    .action(commandAction(showTargetingRulesReference));

  try {
    await program.parseAsync(invocation.commandLineArguments, { from: "user" });
    return exitCode;
  } catch (error) {
    return reportFailure(invocation, error);
  }
};
