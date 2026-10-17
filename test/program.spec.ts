import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox } from "./support/sandbox.js";

const packageVersion = async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version as string;
};

const optionNamesUnder = (help: string, heading: string): string[] => {
  const lines = help.split("\n");
  const firstOptionLine = lines.indexOf(heading) + 1;
  return lines
    .slice(firstOptionLine, lines.indexOf("", firstOptionLine))
    .map((line) => line.trim().split(" ")[0] ?? "")
    .filter((word) => word.startsWith("--"));
};

describe("program", () => {
  it("prints the package version for --version", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["--version"] });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(invocation.stdout.text()).toEqual(`${await packageVersion()}\n`);
  });

  it("exits 2 with nothing on stdout for an unknown option", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["--no-such-option"] });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stdout.text()).toEqual("");
    expect(invocation.stderr.text()).toContain("--no-such-option");
  });

  it("lists the login and init commands on stdout for --help", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["--help"] });

    const exitCode = await run(invocation);

    const firstWords = invocation.stdout
      .text()
      .split("\n")
      .map((line) => line.trim().split(" ")[0]);
    expect(exitCode).toEqual(0);
    expect(firstWords).toContain("login");
    expect(firstWords).toContain("init");
  });

  it("lists the evaluate command with the beta label on stdout for --help", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["--help"] });

    const exitCode = await run(invocation);

    const firstWords = invocation.stdout
      .text()
      .split("\n")
      .map((line) => line.trim().split(" ")[0]);
    expect(exitCode).toEqual(0);
    expect(firstWords).toContain("evaluate");
    expect(invocation.stdout.text()).toContain("Beta: commands and output may change before 1.0.");
  });

  it("lists the projects, environments, configs and segments commands with the beta label on stdout for --help", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["--help"] });

    const exitCode = await run(invocation);

    const firstWords = invocation.stdout
      .text()
      .split("\n")
      .map((line) => line.trim().split(" ")[0]);
    expect(exitCode).toEqual(0);
    expect(firstWords).toEqual(expect.arrayContaining(["projects", "environments", "configs", "segments"]));
    expect(invocation.stdout.text()).toContain("Beta: commands and output may change before 1.0.");
  });

  it("lists the list verb with the beta label in the help of projects", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["projects", "--help"] });

    const exitCode = await run(invocation);

    const help = invocation.stdout.text();
    expect(exitCode).toEqual(0);
    expect(help.split("\n").map((line) => line.trim().split(" ")[0])).toContain("list");
    expect(help).toContain("Beta: commands and output may change before 1.0.");
  });

  it("lists the list verb with the beta label in the help of environments", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["environments", "--help"] });

    const exitCode = await run(invocation);

    const help = invocation.stdout.text();
    expect(exitCode).toEqual(0);
    expect(help.split("\n").map((line) => line.trim().split(" ")[0])).toContain("list");
    expect(help).toContain("Beta: commands and output may change before 1.0.");
  });

  it("lists the list, get, activity and create verbs with the beta label in the help of configs", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["configs", "--help"] });

    const exitCode = await run(invocation);

    const help = invocation.stdout.text();
    expect(exitCode).toEqual(0);
    expect(help.split("\n").map((line) => line.trim().split(" ")[0])).toEqual(
      expect.arrayContaining(["list", "get", "activity", "create"]),
    );
    expect(help).toContain("Beta: commands and output may change before 1.0.");
  });

  it("groups the options of configs create by the types they apply to, with the beta label, in its help", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["configs", "create", "--help"] });

    const exitCode = await run(invocation);

    const help = invocation.stdout.text();
    expect(exitCode).toEqual(0);
    expect(optionNamesUnder(help, "Options for --type integer, float or timespan:")).toEqual([
      "--min",
      "--max",
    ]);
    expect(optionNamesUnder(help, "Options for --type integer or float:")).toEqual([
      "--exclusive-min",
      "--exclusive-max",
    ]);
    expect(optionNamesUnder(help, "Options for --type timespan:")).toEqual(["--unit", "--allow-fractions"]);
    expect(optionNamesUnder(help, "Options for --type enum:")).toEqual([
      "--allowed-value",
      "--enum-value-type",
    ]);
    expect(optionNamesUnder(help, "Options for --type url:")).toEqual(["--https-only"]);
    expect(optionNamesUnder(help, "Options for --type json:")).toEqual(["--json-schema"]);
    expect(help).toContain("Beta: commands and output may change before 1.0.");
  });

  it("calls --default-value the default targeting rule value in the help of configs create", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["configs", "create", "--help"] });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(invocation.stdout.text().replace(/\s+/g, " ")).toContain(
      "--default-value <value> the default targeting rule value every environment starts with",
    );
  });

  it("lists the list and get verbs with the beta label in the help of segments", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["segments", "--help"] });

    const exitCode = await run(invocation);

    const help = invocation.stdout.text();
    expect(exitCode).toEqual(0);
    expect(help.split("\n").map((line) => line.trim().split(" ")[0])).toEqual(
      expect.arrayContaining(["list", "get"]),
    );
    expect(help).toContain("Beta: commands and output may change before 1.0.");
  });

  it("lists evaluate's options without defaults for options that have none, and the beta label, in its help", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["evaluate", "--help"] });

    const exitCode = await run(invocation);

    const help = invocation.stdout.text();
    const firstWords = help.split("\n").map((line) => line.trim().split(" ")[0]);
    expect(exitCode).toEqual(0);
    expect(firstWords).toEqual(
      expect.arrayContaining([
        "--environment",
        "--context-kind",
        "--context-id",
        "--context-name",
        "--context-trait",
        "--context-json",
        "--saved-context",
      ]),
    );
    expect(help).not.toContain("(default: [])");
    expect(help).toContain("Beta: commands and output may change before 1.0.");
  });

  it("exits 2 with nothing on stdout when no command is given", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: [] });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stdout.text()).toEqual("");
  });

  it("lists the global options in a command's help", async () => {
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({ commandLineArguments: ["init", "--help"] });

    const exitCode = await run(invocation);

    const firstWords = invocation.stdout
      .text()
      .split("\n")
      .map((line) => line.trim().split(" ")[0]);
    expect(exitCode).toEqual(0);
    expect(firstWords).toEqual(expect.arrayContaining(["--token", "--base-url", "--project", "--json"]));
  });
});
