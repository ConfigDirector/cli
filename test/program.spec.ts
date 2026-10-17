import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox } from "./support/sandbox.js";

const packageVersion = async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version as string;
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
