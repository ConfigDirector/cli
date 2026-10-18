import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Invocation } from "../Invocation.js";

const execFileAsync = promisify(execFile);

export type GitCheckout =
  | { kind: "origin-remote"; remoteUrl: string; commit: string }
  | { kind: "git-missing" }
  | { kind: "no-repository"; gitMessage: string }
  | { kind: "no-origin-remote" };

type GitOutput =
  { kind: "printed"; text: string } | { kind: "git-missing" } | { kind: "failed"; message: string };

const firstLineOf = (text: string): string => text.trim().split("\n")[0] ?? "";

const gitOutput = async (
  directory: string,
  environmentVariables: Invocation["environmentVariables"],
  gitArguments: string[],
): Promise<GitOutput> => {
  try {
    const { stdout } = await execFileAsync("git", gitArguments, {
      cwd: directory,
      env: { ...environmentVariables },
    });
    return { kind: "printed", text: stdout.trim() };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    return failure.code === "ENOENT"
      ? { kind: "git-missing" }
      : { kind: "failed", message: firstLineOf(failure.stderr ?? "") };
  }
};

export const readGitCheckout = async (
  directory: string,
  environmentVariables: Invocation["environmentVariables"],
): Promise<GitCheckout> => {
  const workTree = await gitOutput(directory, environmentVariables, ["rev-parse", "--is-inside-work-tree"]);
  switch (workTree.kind) {
    case "git-missing":
      return { kind: "git-missing" };
    case "failed":
      return { kind: "no-repository", gitMessage: workTree.message };
    case "printed":
      break;
  }
  const remoteUrl = await gitOutput(directory, environmentVariables, ["remote", "get-url", "origin"]);
  if (remoteUrl.kind !== "printed") {
    return { kind: "no-origin-remote" };
  }
  const commit = await gitOutput(directory, environmentVariables, ["rev-parse", "HEAD"]);
  return {
    kind: "origin-remote",
    remoteUrl: remoteUrl.text,
    commit: commit.kind === "printed" ? commit.text : "",
  };
};
