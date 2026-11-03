#!/usr/bin/env node
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { homedir } from "node:os";
import { run } from "./run.js";

const millisecondsEachAddressGetsToConnect = 2_000;

setDefaultAutoSelectFamilyAttemptTimeout(millisecondsEachAddressGetsToConnect);

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
