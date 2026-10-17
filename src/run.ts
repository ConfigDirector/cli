import { Command, CommanderError, Option, type OptionValues } from "commander";
import { version } from "../package.json";
import { CliError } from "./CliError.js";
import type { CommandContext, CommandOutput } from "./CommandContext.js";
import { ExitCode } from "./ExitCode.js";
import { nonEmptyVariable, type Invocation } from "./Invocation.js";
import { getConfig, LIFECYCLE_STATES, listConfigs, showConfigActivity } from "./commands/configs.js";
import { listEnvironments } from "./commands/environments.js";
import { evaluate } from "./commands/evaluate.js";
import { init } from "./commands/init.js";
import { login } from "./commands/login.js";
import { listProjects } from "./commands/projects.js";
import { scan } from "./commands/scan.js";
import { getSegment, listSegments } from "./commands/segments.js";
import { validate } from "./commands/validate.js";

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
    .description("list a project's configs and show one config");

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

  try {
    await program.parseAsync(invocation.commandLineArguments, { from: "user" });
    return exitCode;
  } catch (error) {
    return reportFailure(invocation, error);
  }
};
