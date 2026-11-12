import { Command, CommanderError, InvalidArgumentError, Option, type OptionValues } from "commander";
import { version } from "../package.json";
import { CliError } from "./CliError.js";
import type { CommandContext, CommandOutput } from "./CommandContext.js";
import { ExitCode } from "./ExitCode.js";
import { nonEmptyVariable, type Invocation } from "./Invocation.js";
import { getApiToken } from "./commands/api-token.js";
import {
  archiveConfig,
  copyConfig,
  createConfig,
  getConfig,
  LIFECYCLE_STATES,
  listConfigs,
  shipVariation,
  showConfigActivity,
  showConfigRuns,
  stopRun,
} from "./commands/configs.js";
import { listEnvironments } from "./commands/environments.js";
import { evaluate } from "./commands/evaluate.js";
import { init } from "./commands/init.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { createMetric, deleteMetric, getMetric, listMetrics, updateMetric } from "./commands/metrics.js";
import { listProjects } from "./commands/projects.js";
import { listScannedRepositories, removeScannedRepository } from "./commands/repositories.js";
import { DEFAULT_CONTEXT_LINES, MAXIMUM_CONTEXT_LINES, scan } from "./commands/scan.js";
import {
  createSegment,
  deleteSegment,
  getSegment,
  listSegments,
  updateSegment,
} from "./commands/segments.js";
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
import { METRIC_DIRECTIONS, METRIC_KINDS } from "./metrics/metric-words.js";

const DEFAULT_BASE_URL = "https://api.configdirector.com";

const NO_HEADERS_DESCRIPTION = "leave out the header row";

const METRIC_EVENT_NAME_DESCRIPTION =
  "the metric's event name, as the application passes it to track, while only one metric has it";

const METRIC_ID_DESCRIPTION =
  "the metric's id, which names one of several metrics with the same event name, in place of the event name";

const SEVERAL_METRICS_HELP =
  "When several metrics have the event name, the command lists them with their ids and exits with 2 " +
  "without changing anything. Name one with --id.";

const SEGMENT_FILE_DESCRIPTION =
  "a JSON file holding the segment as the Admin API takes it, or - to read it from stdin (required)";

type GlobalOptions = {
  token?: string;
  baseUrl?: string;
  project?: string;
  organization?: string;
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

const repeatableChoiceOption = (flags: string, description: string, choices: readonly string[]): Option =>
  new Option(flags, description)
    .choices(choices)
    .argParser((value: string, values: string[] | undefined): string[] => {
      if (!choices.includes(value)) {
        throw new InvalidArgumentError(`Allowed choices are ${choices.join(", ")}.`);
      }
      return repeatedOption(value, values);
    });

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
      organizationOption: options.organization ?? nonEmptyVariable(invocation, "CONFIGDIRECTOR_ORGANIZATION"),
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
    .addHelpText("afterAll", "\nCommands and output may change before 1.0.")
    .configureHelp({ showGlobalOptions: true })
    .version(version)
    .option(
      "--token <token>",
      "API token, used instead of CONFIGDIRECTOR_TOKEN and the CLI sign-ins saved by login",
    )
    .option(
      "--base-url <url>",
      `Admin API host, used instead of CONFIGDIRECTOR_BASE_URL (default ${DEFAULT_BASE_URL})`,
    )
    .option("--project <slug>", "project slug, used instead of CONFIGDIRECTOR_PROJECT")
    .option(
      "--organization <name or id>",
      "organization whose CLI sign-in to use, by its saved name or its id, " +
        "used instead of CONFIGDIRECTOR_ORGANIZATION and `organization` in configdirector.json",
    )
    .option("--json", "print JSON on stdout")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => invocation.stdout.write(text),
      writeErr: (text) => invocation.stderr.write(text),
    });

  program
    .command("login")
    .description(
      "save an API token as the CLI sign-in for its organization, after checking it can find projects",
    )
    .action(commandAction(login));

  program
    .command("logout")
    .description("remove the CLI sign-in this directory's commands would use; the token itself keeps working")
    .action(commandAction(logout));

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
    .addOption(
      new Option(
        "--context-lines <number>",
        "how many lines of code to include before and after each reference, " +
          `from 0 to ${MAXIMUM_CONTEXT_LINES} (default: ${DEFAULT_CONTEXT_LINES})`,
      ).conflicts("snippets"),
    )
    .option("--no-snippets", "leave out the lines of code around each reference")
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
    .command("api-token")
    .description("describe the API token a command here would use")
    .command("get")
    .description(
      "show the token's organization, name, permissions and expiration, and where it came from; never the token itself",
    )
    .action(commandAction(getApiToken));

  program
    .command("projects")
    .description("list the projects of the API token's organization")
    .command("list")
    .description("list the organization's projects, whatever project is selected")
    .option("--no-headers", NO_HEADERS_DESCRIPTION)
    .action(commandAction(listProjects));

  program
    .command("environments")
    .description("list the project's environments")
    .command("list")
    .description("list the project's environments with their slugs, marking the live ones")
    .option("--no-headers", NO_HEADERS_DESCRIPTION)
    .action(commandAction(listEnvironments));

  const configsCommand = program
    .command("configs")
    .description(
      "list, show, create, copy and archive a project's configs, and list, ship and stop an experiment's runs",
    );

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
    .option("--no-headers", NO_HEADERS_DESCRIPTION)
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
    .option("--no-headers", NO_HEADERS_DESCRIPTION)
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
      new Option(
        "--lifetime <lifetime>",
        "whether the config is expected to be removed; required with --role config, " +
          "while a feature flag and an experiment are always temporary and a kill switch always permanent",
      ).choices(CONFIG_LIFETIMES),
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
      "--new-tag <name>",
      "create a tag with this name in the project's tag catalog and assign it; repeatable",
      repeatedOption,
    )
    .option(
      "--variation <name=value>",
      "a variation of an experiment, its value in the type given by --type; repeatable",
      repeatedOption,
    )
    .option(
      "--hypothesis <text>",
      "what an experiment is expected to do; each run keeps the hypothesis it started with",
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
    .command("copy")
    .argument("<key>", "the key of the config to copy, or an old key of it")
    .description(
      "copy a config under a new key, in its project or in another project of the organization, and print the plan",
    )
    .requiredOption("--key <key>", "the copy's key (required)")
    .option(
      "--to <project slug>",
      "slug of the project to copy the config into, another project of the organization (default: the config's project)",
    )
    .option(
      "--environment <destination slug>=<source slug>",
      "the source environment whose targeting rules an environment of the destination project starts with, " +
        "needed for each destination environment with no source environment of its slug; repeatable",
      repeatedOption,
    )
    .option("--dry-run", "print the plan without creating anything")
    .addHelpText(
      "after",
      "\nThe copy gets the config's role, lifetime, type, constraints, variations, SDK availability, description, " +
        "hypothesis and tags, and every environment's targeting rules and default targeting rule value. It starts as a new " +
        "config, with no old keys, evaluations or code references, and shares nothing with the config it came from. " +
        "An archived config cannot be copied; restore it first. " +
        "In another project, environments are matched by slug, tags by name and segments by key: a source " +
        "environment with no environment of its slug there is skipped, and an environment there with no source " +
        "environment of its slug needs --environment. A targeting rule that uses a segment the other project " +
        "doesn't have is dropped. A tag it doesn't have is created when the API token can create tags, and " +
        "skipped otherwise. The plan names every skipped environment, dropped rule and tag; --dry-run shows it " +
        "without creating anything.",
    )
    .action(commandAction(copyConfig));

  configsCommand
    .command("runs")
    .argument("<key>", "the experiment's key, or an old key of it")
    .description("list an experiment's runs in an environment with their exposures and results, newest first")
    .requiredOption("--environment <slug>", "slug of the environment to list the runs of (required)")
    .action(commandAction(showConfigRuns));

  configsCommand
    .command("ship")
    .argument("<key>", "the experiment's key, or an old key of it")
    .description("serve one variation of an experiment to everyone in an environment, ending its run")
    .requiredOption("--environment <slug>", "slug of the environment to ship the variation in (required)")
    .requiredOption("--variation <variation>", "the name or id of the variation to ship (required)")
    .option("--note <text>", "why the variation is shipped, kept on the ended run")
    .addHelpText(
      "after",
      "\nIn one targeting rules save, the default targeting rule value becomes the variation's value, every " +
        "percentage rollout is removed, including one a conditional rule serves, and a conditional rule serving a " +
        "single value stays. It asks for no confirmation and treats a live environment like any other.",
    )
    .action(commandAction(shipVariation));

  configsCommand
    .command("stop")
    .argument("<key>", "the experiment's key, or an old key of it")
    .description("end an experiment's run in an environment without choosing a variation")
    .requiredOption("--environment <slug>", "slug of the environment to stop the run in (required)")
    .option("--note <text>", "why the run is stopped, kept on the ended run")
    .addHelpText(
      "after",
      "\nIn one targeting rules save, every percentage rollout is removed, including one a conditional rule serves, " +
        "the default targeting rule value stays, and a conditional rule serving a single value stays. It asks for " +
        "no confirmation and treats a live environment like any other. When the config is not an experiment, or no " +
        "percentage rollout is saved in the environment, there is no run to stop, and the command exits with 2.",
    )
    .action(commandAction(stopRun));

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
    .description("list, show, create, update and delete a project's segments");

  segmentsCommand
    .command("list")
    .description("list the project's segments with how many configs use each")
    .option("--no-headers", NO_HEADERS_DESCRIPTION)
    .action(commandAction(listSegments));

  segmentsCommand
    .command("get")
    .argument("<key>", "the segment's key")
    .description("show a segment's condition groups and its environment overrides")
    .action(commandAction(getSegment));

  segmentsCommand
    .command("create")
    .description("create a segment from a JSON file")
    .requiredOption("--segment <file>", SEGMENT_FILE_DESCRIPTION)
    .addHelpText(
      "after",
      '\nThe file holds {"key": ..., "name": ..., "groups": [...], "overrides": {...}}, like the output of ' +
        "segments get --json, so you can edit that output and send it. groups lists the condition groups, " +
        "and a context is in the segment when every condition of any one group matches. overrides is optional: " +
        "it maps an environment's id, which environments list --json shows, to the condition groups used there " +
        "instead. A condition without an id gets a new one.",
    )
    .action(commandAction(createSegment));

  segmentsCommand
    .command("update")
    .argument("<key>", "the segment's key")
    .description(
      "replace a segment's key, name and condition groups with a JSON file, and its environment overrides when the file has them",
    )
    .requiredOption("--segment <file>", SEGMENT_FILE_DESCRIPTION)
    .addHelpText(
      "after",
      "\nThe file takes the same form as for segments create, and the segment keeps its id whatever id the file " +
        "holds. Its key, name and condition groups are replaced, so a different key renames it. " +
        "Without overrides in the file, the environment overrides stay as they are; " +
        'with "overrides": {} they are all removed, and a map leaves exactly those environments overridden. ' +
        "A condition without an id gets a new one.",
    )
    .action(commandAction(updateSegment));

  segmentsCommand
    .command("delete")
    .argument("<key>", "the segment's key")
    .description("delete a segment and its environment overrides")
    .addHelpText(
      "after",
      "\nThe segment is deleted with no confirmation. While the targeting rules of a config use it, " +
        "the deletion is refused and the configs are listed with their environments.",
    )
    .action(commandAction(deleteSegment));

  const metricsCommand = program
    .command("metrics")
    .description("list, show, create, update and delete the metrics a project's experiments measure");

  metricsCommand
    .command("list")
    .description("list the project's metrics with their kinds, direction and how many experiments use each")
    .option("--no-headers", NO_HEADERS_DESCRIPTION)
    .action(commandAction(listMetrics));

  metricsCommand
    .command("get")
    .argument("[event name]", METRIC_EVENT_NAME_DESCRIPTION)
    .option("--id <metric id>", METRIC_ID_DESCRIPTION)
    .description("show a metric's kinds and direction, and the experiments that use it")
    .addHelpText("after", `\n${SEVERAL_METRICS_HELP}`)
    .action(commandAction(getMetric));

  metricsCommand
    .command("create")
    .description("create a metric for an event name the application passes to track")
    .requiredOption(
      "--event-name <event name>",
      "the event name, exactly as the application passes it to track (required)",
    )
    .option(
      "--filter <file>",
      "a JSON file holding the conditions an event's details must match for the event to count, " +
        "or - to read them from stdin",
    )
    .option(
      "--value-field <pointer>",
      "a JSON pointer, such as /items, to the field of the event's details holding the number " +
        "that value per context sums in place of the event's value",
    )
    .addOption(
      repeatableChoiceOption(
        "--kind <kind>",
        "a number the metric reports: conversion, the share of exposed contexts that sent the event; " +
          "count-per-context, how many times each sent it on average; value-per-context, the value sent with it " +
          "per context on average; repeatable (required)",
        METRIC_KINDS,
      ).makeOptionMandatory(),
    )
    .addOption(
      new Option("--direction <direction>", "whether a higher or a lower number is better (required)")
        .choices(METRIC_DIRECTIONS)
        .makeOptionMandatory(),
    )
    .option("--description <text>", "what the event means")
    .addHelpText(
      "after",
      "\nThe --filter file holds a list of 1 to 5 conditions, all of which an event must match to count, like " +
        "the filter that metrics get --json prints. For the checkouts on the Team plan: " +
        '[{"field": "/plan", "targetType": "text", "operator": "is one of", "targetValues": ["team"]}]. ' +
        "field is a JSON pointer into the details the application sends with the event. A text condition " +
        'takes is one of or is NOT one of; a number condition =, !=, >, >=, < or <=, with its number as text, such as "2"; ' +
        'and a boolean condition equals, with "true" or "false". A field an event lacks reads as empty text, ' +
        "so is NOT one of and != count an event without it.\n" +
        "\n--value-field /items sums the number each event's details hold at /items for value-per-context, in place " +
        "of the event's value, and needs --kind value-per-context.\n" +
        "\nA metric keeps its filter and value field for its whole life: for others, create another metric. " +
        "A metric with a filter or a value field is counted from the moment it is attached to an experiment.",
    )
    .action(commandAction(createMetric));

  metricsCommand
    .command("update")
    .argument("[event name]", METRIC_EVENT_NAME_DESCRIPTION)
    .option("--id <metric id>", METRIC_ID_DESCRIPTION)
    .description("change a metric's kinds, direction or description, leaving the others as they are")
    .addOption(
      repeatableChoiceOption(
        "--kind <kind>",
        "a number the metric reports; repeatable, and the kinds given replace the metric's",
        METRIC_KINDS,
      ),
    )
    .addOption(
      new Option("--direction <direction>", "whether a higher or a lower number is better").choices(
        METRIC_DIRECTIONS,
      ),
    )
    .option("--description <text>", 'what the event means; --description "" removes it')
    .addHelpText(
      "after",
      "\nA metric keeps its event name, filter and value field: for others, create another metric. Removing a kind " +
        "that an experiment's primary metric decides on is refused, and the experiments are listed.\n\n" +
        SEVERAL_METRICS_HELP,
    )
    .action(commandAction(updateMetric));

  metricsCommand
    .command("delete")
    .argument("[event name]", METRIC_EVENT_NAME_DESCRIPTION)
    .option("--id <metric id>", METRIC_ID_DESCRIPTION)
    .description("delete a metric and detach it from the experiments that use it")
    .addHelpText(
      "after",
      "\nThe metric is deleted with no confirmation. While an experiment that uses it has a run in progress, " +
        "the deletion is refused and the experiments are listed with the environments of their runs. " +
        "Events with its name keep being counted, so a metric created again for the name without a filter or a " +
        "value field and attached again shows their history, while one with a filter or a value field is counted " +
        "from the moment it is attached.\n\n" +
        SEVERAL_METRICS_HELP,
    )
    .action(commandAction(deleteMetric));

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

  const repositoriesCommand = program
    .command("repositories")
    .description("list a project's scanned repositories and remove one");

  repositoriesCommand
    .command("list")
    .description(
      "list the repositories whose scan was uploaded to the project, with their commit, scan time and reference counts",
    )
    .option("--no-headers", NO_HEADERS_DESCRIPTION)
    .action(commandAction(listScannedRepositories));

  repositoriesCommand
    .command("remove")
    .argument("<name>", "the repository's name, as repositories list shows it, such as ConfigDirector/cli")
    .description("remove a scanned repository and its code references from the project")
    .addHelpText(
      "after",
      "\nThe repository is removed with no confirmation, and the dashboard stops showing its code references. " +
        "The next scan --upload from it adds it back.",
    )
    .action(commandAction(removeScannedRepository));

  try {
    await program.parseAsync(invocation.commandLineArguments, { from: "user" });
    return exitCode;
  } catch (error) {
    return reportFailure(invocation, error);
  }
};
