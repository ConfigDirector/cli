import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const reproducibleGitEnvironment = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ada Lovelace",
  GIT_AUTHOR_EMAIL: "ada@example.com",
  GIT_AUTHOR_DATE: "2026-10-17T10:00:00Z",
  GIT_COMMITTER_NAME: "Ada Lovelace",
  GIT_COMMITTER_EMAIL: "ada@example.com",
  GIT_COMMITTER_DATE: "2026-10-17T10:00:00Z",
};

const git = (directory: string, gitArguments: string[]) =>
  execFileAsync("git", gitArguments, { cwd: directory, env: reproducibleGitEnvironment });

export const initializeGitRepository = async (directory: string) => {
  await git(directory, ["init", "--quiet", "--initial-branch=main"]);
};

export const addOriginRemote = async (directory: string, remoteUrl: string) => {
  await git(directory, ["remote", "add", "origin", remoteUrl]);
};

export const commitEveryFile = async (directory: string) => {
  await git(directory, ["add", "--all"]);
  await git(directory, ["commit", "--quiet", "--message", "Read the new checkout flag"]);
};

export const createRepositoryWithOrigin = async (directory: string, remoteUrl: string) => {
  await initializeGitRepository(directory);
  await addOriginRemote(directory, remoteUrl);
  await commitEveryFile(directory);
};
