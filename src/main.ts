#!/usr/bin/env node
import { homedir } from "node:os";
import { run } from "./run.js";

process.exitCode = await run({
  commandLineArguments: process.argv.slice(2),
  environmentVariables: process.env,
  workingDirectory: process.cwd(),
  homeDirectory: homedir(),
  platform: process.platform,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
