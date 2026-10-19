import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { run } from "../../src/run.js";
import type { Sandbox } from "./sandbox.js";
import {
  startStubAdminApi,
  type ReceivedRequest,
  type StubReply,
  type StubReplyForRequest,
} from "./stub-admin-api.js";

type Organization = { id: string; name: string };

export const acme: Organization = { id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", name: "Acme" };

export const globex: Organization = { id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", name: "Globex" };

type ListedProject = { id: string; name: string; slug: string; organizationId: string };

export const projectOf = (
  organization: Organization,
  slug: string,
  name: string,
  id: string,
): ListedProject => ({
  id,
  name,
  slug,
  organizationId: organization.id,
});

export const acmeWebApp = projectOf(acme, "web-app", "Web App", "4f0c1d2e-8a51-4c3b-9b6e-2d7f8a9b0c1d");

export const globexWebApp = projectOf(globex, "web-app", "Web App", "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918");

type ApiTokenAccount = {
  token: string;
  name?: string;
  organization: Organization;
  permissions?: string[];
  expiresAt?: string | null;
  projects?: ListedProject[];
};

const apiTokenNotFound: StubReply = {
  status: 403,
  body: {
    error: "No API token matches the bearer token. It may have been deleted or its organization disabled.",
    code: "API_TOKEN_NOT_FOUND",
  },
};

const accountOf = (accounts: ApiTokenAccount[], request: ReceivedRequest): ApiTokenAccount | undefined =>
  accounts.find((account) => request.headers.authorization === `Bearer ${account.token}`);

export const describedApiToken = (account: ApiTokenAccount) => ({
  name: account.name ?? "Laptop",
  organization: account.organization,
  permissions: account.permissions ?? ["configs:read", "projects:read"],
  expiresAt: account.expiresAt ?? null,
});

export const startSignInAdminApi = (
  accounts: ApiTokenAccount[],
  repliesByPath: Record<string, StubReplyForRequest> = {},
) =>
  startStubAdminApi(
    { status: 404, body: {} },
    {
      "/v1/api-token": (request) => {
        const account = accountOf(accounts, request);
        return account === undefined ? apiTokenNotFound : { status: 200, body: describedApiToken(account) };
      },
      "/v1/projects": (request) => {
        const account = accountOf(accounts, request);
        return account === undefined ? apiTokenNotFound : { status: 200, body: account.projects ?? [] };
      },
      ...repliesByPath,
    },
  );

export const logIn = async (sandbox: Sandbox, baseUrl: string, token: string) => {
  await run(
    sandbox.invocation({
      commandLineArguments: ["login"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
      stdin: Readable.from([`${token}\n`]),
    }),
  );
};

export const userConfigDirectoryOf = (sandbox: Sandbox) =>
  join(sandbox.homeDirectory, ".config", "configdirector");

export const readSignInsFile = async (sandbox: Sandbox) =>
  JSON.parse(await readFile(join(userConfigDirectoryOf(sandbox), "sign-ins.json"), "utf8"));

export const signInsFileExists = (sandbox: Sandbox) =>
  access(join(userConfigDirectoryOf(sandbox), "sign-ins.json")).then(
    () => true,
    () => false,
  );
