import { CliError } from "../CliError.js";
import type { GitCheckout } from "./git-checkout.js";

type RepositoryIdentity = { name: string; remoteUrl: string; commit: string };

type OriginRemote = { path: string; uploadedUrl: string };

const URL_SCHEME_SEPARATOR = "://";

const GIT_SUFFIX = ".git";

const HTTP_PROTOCOLS = ["http:", "https:"];

const carriesHttpCredentials = (url: URL): boolean =>
  HTTP_PROTOCOLS.includes(url.protocol) && (url.username !== "" || url.password !== "");

const withoutCredentials = (url: URL): string => {
  const urlWithoutCredentials = new URL(url);
  urlWithoutCredentials.username = "";
  urlWithoutCredentials.password = "";
  return urlWithoutCredentials.href;
};

const originRemoteOf = (remoteUrl: string): OriginRemote => {
  if (!remoteUrl.includes(URL_SCHEME_SEPARATOR)) {
    return { path: remoteUrl.slice(remoteUrl.indexOf(":") + 1), uploadedUrl: remoteUrl };
  }
  const url = new URL(remoteUrl);
  return {
    path: url.pathname.slice(1),
    uploadedUrl: carriesHttpCredentials(url) ? withoutCredentials(url) : remoteUrl,
  };
};

const repositoryNameOf = (remote: OriginRemote): string =>
  remote.path.endsWith(GIT_SUFFIX) ? remote.path.slice(0, -GIT_SUFFIX.length) : remote.path;

type UnnamedCheckout = Exclude<GitCheckout, { kind: "origin-remote" }>;

const unnamedCheckoutReason = (checkout: UnnamedCheckout, scannedLocation: string): string => {
  switch (checkout.kind) {
    case "git-missing":
      return "git is not installed or not on the PATH";
    case "no-repository":
      return `git cannot read a repository in ${scannedLocation} (${checkout.gitMessage})`;
    case "no-origin-remote":
      return `the git repository in ${scannedLocation} has no remote named origin`;
  }
};

const unnamedRepositoryError = (checkout: UnnamedCheckout, scannedLocation: string) =>
  new CliError(
    "scan --upload names the repository after its git remote origin, " +
      `but ${unnamedCheckoutReason(checkout, scannedLocation)}. ` +
      "Name the repository with --repository <name>.",
  );

export const repositoryIdentityOf = (
  checkout: GitCheckout,
  repositoryOption: string | undefined,
  scannedLocation: string,
): RepositoryIdentity => {
  if (checkout.kind === "origin-remote") {
    const remote = originRemoteOf(checkout.remoteUrl);
    return {
      name: repositoryOption ?? repositoryNameOf(remote),
      remoteUrl: remote.uploadedUrl,
      commit: checkout.commit,
    };
  }
  if (repositoryOption === undefined) {
    throw unnamedRepositoryError(checkout, scannedLocation);
  }
  return { name: repositoryOption, remoteUrl: "", commit: "" };
};
