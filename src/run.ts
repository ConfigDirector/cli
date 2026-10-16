import { Command, CommanderError } from "commander";
import { version } from "../package.json";
import { CliError } from "./CliError.js";
import type { CommandContext, CommandOutput } from "./CommandContext.js";
import { nonEmptyVariable, type Invocation } from "./Invocation.js";
import { init } from "./commands/init.js";
import { login } from "./commands/login.js";
import { scan } from "./commands/scan.js";

const ExitCode = { success: 0, couldNotRun: 2 } as const;
type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

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

const commandAction =
  (
    invocation: Invocation,
    command: (
      context: CommandContext,
      commandArguments: ReadonlyArray<string | undefined>,
    ) => Promise<CommandOutput>,
  ) =>
  async (...actionArguments: unknown[]) => {
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
      parsedCommand.processedArgs,
    );
    invocation.stdout.write(options.json ? `${JSON.stringify(output.json, null, 2)}\n` : output.text);
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
    .action(commandAction(invocation, login));

  program
    .command("init")
    .description("write configdirector.json for a project in the current directory")
    .action(commandAction(invocation, init));

  program
    .command("scan")
    .argument("[path]", "directory or file to scan (default: the current directory)")
    .description("list where the code reads config keys through a ConfigDirector SDK")
    .action(commandAction(invocation, scan));

  try {
    await program.parseAsync(invocation.commandLineArguments, { from: "user" });
    return ExitCode.success;
  } catch (error) {
    return reportFailure(invocation, error);
  }
};
