import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { createSandbox } from "./support/sandbox.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const webApp = {
  id: "4f0c1d2e-8a51-4c3b-9b6e-2d7f8a9b0c1d",
  name: "Web App",
  slug: "web-app",
  organizationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const runInit = async (baseUrl: string) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: ["init", "--project", "web-app", "--token", "cd_flag_token"],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });
  const exitCode = await run(invocation);
  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const closedPortBaseUrl = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
};

const packageVersion = async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version as string;
};

describe("Admin API requests", () => {
  it("send the bearer token, the cli source client and the CLI's user agent on every request", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const environmentVariables = { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl };

    await run(
      sandbox.invocation({
        commandLineArguments: ["login"],
        environmentVariables,
        stdin: Readable.from(["cd_pasted_token\n"]),
      }),
    );
    await run(
      sandbox.invocation({ commandLineArguments: ["init", "--project", "web-app"], environmentVariables }),
    );

    const userAgent = `configdirector-cli/${await packageVersion()}`;
    expect(
      adminApi.receivedRequests.map(({ headers }) => ({
        authorization: headers.authorization,
        sourceClient: headers["x-sourceclient"],
        userAgent: headers["user-agent"],
      })),
    ).toEqual([
      { authorization: "Bearer cd_pasted_token", sourceClient: "cli", userAgent },
      { authorization: "Bearer cd_pasted_token", sourceClient: "cli", userAgent },
    ]);
  });

  it("go to --base-url rather than CONFIGDIRECTOR_BASE_URL", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });
    const sandbox = await createSandbox();
    const invocation = sandbox.invocation({
      commandLineArguments: [
        "init",
        "--project",
        "web-app",
        "--token",
        "cd_flag_token",
        "--base-url",
        adminApi.baseUrl,
      ],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: await closedPortBaseUrl() },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual(["/v1/projects"]);
  });

  it("go under the base URL's path when it ends with a slash", async () => {
    const adminApi = await startStubAdminApi({ status: 200, body: [webApp] });

    const { exitCode } = await runInit(`${adminApi.baseUrl}/proxy/`);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual(["/proxy/v1/projects"]);
  });
});

describe("Admin API failures", () => {
  it("exit 2 showing AUTHORIZATION_HEADER_MISSING when the request reached the API without an Authorization header", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: {
        error: "The Authorization header is missing. Send `Authorization: Bearer <api token>`.",
        code: "AUTHORIZATION_HEADER_MISSING",
      },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("AUTHORIZATION_HEADER_MISSING");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing AUTHORIZATION_HEADER_INVALID when the API cannot read the Authorization header", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: {
        error: "The Authorization header must be `Bearer <api token>`.",
        code: "AUTHORIZATION_HEADER_INVALID",
      },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("AUTHORIZATION_HEADER_INVALID");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing API_TOKEN_NOT_FOUND when no API token matches", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: {
        error:
          "No API token matches the bearer token. It may have been deleted or its organization disabled.",
        code: "API_TOKEN_NOT_FOUND",
      },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("API_TOKEN_NOT_FOUND");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing API_TOKEN_OWNER_REMOVED when the token's creator left the organization", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: {
        error:
          "The user who created the API token no longer belongs to the organization. Generate a new token.",
        code: "API_TOKEN_OWNER_REMOVED",
      },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("API_TOKEN_OWNER_REMOVED");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing INSUFFICIENT_PERMISSIONS and the missing permission when the token lacks it", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: {
        error: "The API token is missing the `projects:read` permission.",
        code: "INSUFFICIENT_PERMISSIONS",
      },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
    expect(stderr).toContain("projects:read");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing API_TOKEN_EXPIRED when the token has expired", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      body: { error: "The API token expired on 2026-10-01T00:00:00.000Z.", code: "API_TOKEN_EXPIRED" },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("API_TOKEN_EXPIRED");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing the status when a 403 comes without the API's error body", async () => {
    const adminApi = await startStubAdminApi({
      status: 403,
      rawBody: "<html><body>Access denied</body></html>",
      headers: { "content-type": "text/html" },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("403");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing when to retry when the organization's service is suspended", async () => {
    const adminApi = await startStubAdminApi({
      status: 429,
      body: { error: "Service suspended", code: "SERVICE_SUSPENDED" },
      headers: { "retry-after": "300" },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("300");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing the status when a 429 is not the API's service suspension", async () => {
    const adminApi = await startStubAdminApi({
      status: 429,
      rawBody: "Too many requests",
      headers: { "content-type": "text/plain", "retry-after": "60" },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("429");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing the status when a service suspension comes without Retry-After", async () => {
    const adminApi = await startStubAdminApi({
      status: 429,
      body: { error: "Service suspended", code: "SERVICE_SUSPENDED" },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("429");
    expect(stdout).toEqual("");
  });

  it("exit 2 listing every validation error the API rejected the request with", async () => {
    const adminApi = await startStubAdminApi({
      status: 400,
      body: {
        errors: [
          { name: "slug", message: "The project slug has an invalid format" },
          { message: "The request body is not valid JSON" },
        ],
      },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("slug: The project slug has an invalid format");
    expect(stderr).toContain("The request body is not valid JSON");
    expect(stdout).toEqual("");
  });

  it("exit 2 showing the status when a 400 comes without the API's errors body", async () => {
    const adminApi = await startStubAdminApi({ status: 400, rawBody: "Bad Request" });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("400");
    expect(stdout).toEqual("");
  });

  it("exit 2 naming the host when the Admin API cannot be reached", async () => {
    const baseUrl = await closedPortBaseUrl();

    const { exitCode, stdout, stderr } = await runInit(baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(baseUrl);
    expect(stdout).toEqual("");
  });

  it("exit 2 showing the status when the Admin API fails with a server error", async () => {
    const adminApi = await startStubAdminApi({ status: 500, body: {} });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("500");
    expect(stdout).toEqual("");
  });

  it("exit 2 naming the URL when the host answers with a web page instead of the Admin API", async () => {
    const adminApi = await startStubAdminApi({
      status: 200,
      rawBody: "<!doctype html><title>ConfigDirector</title>",
      headers: { "content-type": "text/html" },
    });

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(`${adminApi.baseUrl}/v1/projects`);
    expect(stdout).toEqual("");
  });
});
