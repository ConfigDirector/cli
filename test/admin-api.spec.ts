import { readFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, onTestFinished } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { acme, startSignInAdminApi } from "./support/sign-in-admin-api.js";
import {
  connectionClosed,
  connectionReset,
  firstRepliesThen,
  firstReplyThen,
  startStubAdminApi,
  type StubReply,
} from "./support/stub-admin-api.js";

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
  return {
    exitCode,
    stdout: invocation.stdout.text(),
    stderr: invocation.stderr.text(),
    requestedWaits: invocation.requestedWaits,
  };
};

const organizationRequestRateLimitSentence =
  "This organization has reached its limit of 1,200 Admin API requests per minute. Retry after 23 seconds.";

const requestRateLimitReached = (headers: Record<string, string>): StubReply => ({
  status: 429,
  body: { error: organizationRequestRateLimitSentence, code: "REQUEST_RATE_LIMIT_REACHED" },
  headers,
});

const waitingTwentyThreeSecondsLine =
  "The Admin API's request rate limit was reached. Waiting 23 seconds before trying again.\n";

const closedPort = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return typeof address === "object" && address !== null ? address.port : 0;
};

const closedPortBaseUrl = async () => `http://127.0.0.1:${await closedPort()}`;

const startPlainHttpHost = async () => {
  const acceptedSockets: Socket[] = [];
  const server = createServer((socket) => {
    acceptedSockets.push(socket);
    socket.end("HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        acceptedSockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  return {
    port: typeof address === "object" && address !== null ? address.port : 0,
    connectionsAccepted: () => acceptedSockets.length,
  };
};

const packageVersion = async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version as string;
};

describe("Admin API requests", () => {
  it("send the bearer token, the cli source client and the CLI's user agent on every request", async () => {
    const adminApi = await startSignInAdminApi([
      { token: "cd_pasted_token", organization: acme, projects: [webApp] },
    ]);
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

  it("exit 2 showing the API's sentence and PROJECT_ACCESS_DENIED when the project is outside the token's project access", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/projects": { status: 200, body: [webApp] },
        [`/v1/projects/${webApp.id}/configs`]: {
          status: 403,
          body: {
            error: `The API token has no access to the project with id '${webApp.id}'.`,
            code: "PROJECT_ACCESS_DENIED",
          },
        },
      },
    );
    const invocation = (await createSandbox()).invocation({
      commandLineArguments: ["configs", "list", "--project", "web-app", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(2);
    expect(invocation.stdout.text()).toEqual("");
    expect(invocation.stderr.text()).toEqual(
      `Error: The Admin API refused the request: The API token has no access to the project with id '${webApp.id}'. (PROJECT_ACCESS_DENIED)\n`,
    );
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

  it("exit 2 naming why each address of the Admin API's host could not be reached", async () => {
    const port = await closedPort();

    const { exitCode, stdout, stderr } = await runInit(`http://localhost:${port}`);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(`connect ECONNREFUSED 127.0.0.1:${port}`);
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

describe("Admin API connection failures", () => {
  it("repeat a GET whose connection the network reset, and use the answer to the second one", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      { "/v1/projects": firstReplyThen(connectionReset, { status: 200, body: [webApp] }) },
    );

    const { exitCode } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual([
      "/v1/projects",
      "/v1/projects",
    ]);
  });

  it("repeat a GET whose connection closed before the answer, and use the answer to the second one", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      { "/v1/projects": firstReplyThen(connectionClosed, { status: 200, body: [webApp] }) },
    );

    const { exitCode } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual([
      "/v1/projects",
      "/v1/projects",
    ]);
  });

  it("exit 2 naming the host after three attempts when the network resets every connection", async () => {
    const adminApi = await startStubAdminApi(connectionReset);

    const { exitCode, stdout, stderr } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain(adminApi.baseUrl);
    expect(stdout).toEqual("");
    expect(adminApi.receivedRequests.map((request) => request.path)).toEqual([
      "/v1/projects",
      "/v1/projects",
      "/v1/projects",
    ]);
  });

  it("exit 2 after one attempt when the base URL asks for HTTPS from a host that answers in plain HTTP", async () => {
    const plainHttpHost = await startPlainHttpHost();

    const { exitCode } = await runInit(`https://127.0.0.1:${plainHttpHost.port}`);

    expect(exitCode).toEqual(2);
    expect(plainHttpHost.connectionsAccepted()).toEqual(1);
  });
});

describe("Admin API request rate limits", () => {
  it("repeat a GET the request rate limit refused after waiting the seconds Retry-After names, saying so on stderr", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/projects": firstReplyThen(requestRateLimitReached({ "retry-after": "23" }), {
          status: 200,
          body: [webApp],
        }),
      },
    );

    const { exitCode, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", "GET /v1/projects"]);
    expect(requestedWaits).toEqual([23_000]);
    expect(stderr).toEqual(waitingTwentyThreeSecondsLine);
  });

  it("repeat a POST the request rate limit refused, sending the same body again", async () => {
    const sentMetric = {
      eventName: "checkout_completed",
      kinds: ["conversion"],
      direction: "higher-is-better",
    };
    const adminApi = await startBrowseAdminApi({
      "/metrics": firstReplyThen(requestRateLimitReached({ "retry-after": "23" }), {
        status: 201,
        body: {
          id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
          projectId: webApp.id,
          eventName: "checkout_completed",
          filter: null,
          valueField: null,
          ratio: null,
          funnel: null,
          retention: null,
          description: null,
          direction: "higher-is-better",
          kinds: ["conversion"],
          usages: [],
          createdAt: "2026-11-01T10:00:00.000Z",
          updatedAt: "2026-11-01T10:00:00.000Z",
        },
      }),
    });
    const invocation = (await createSandbox()).invocation({
      commandLineArguments: [
        "metrics",
        "create",
        "--event-name",
        "checkout_completed",
        "--kind",
        "conversion",
        "--direction",
        "higher-is-better",
        "--project",
        "web-app",
        "--token",
        "cd_flag_token",
      ],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `POST ${projectPath("/metrics")}`,
      `POST ${projectPath("/metrics")}`,
    ]);
    expect(adminApi.receivedRequests.slice(1).map((request) => request.body)).toEqual([
      sentMetric,
      sentMetric,
    ]);
    expect(invocation.requestedWaits).toEqual([23_000]);
  });

  it("repeat a GET whose connection the network reset after a request rate limit wait, and use the answer to the third one", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/projects": firstRepliesThen(
          [requestRateLimitReached({ "retry-after": "23" }), connectionReset],
          { status: 200, body: [webApp] },
        ),
      },
    );

    const { exitCode, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", "GET /v1/projects", "GET /v1/projects"]);
    expect(requestedWaits).toEqual([23_000]);
  });

  it("exit 2 with the API's sentence when the request rate limit refuses the request again after three waits", async () => {
    const rateLimitReached = requestRateLimitReached({ "retry-after": "23" });
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/projects": firstRepliesThen(
          [rateLimitReached, rateLimitReached, rateLimitReached, rateLimitReached],
          { status: 200, body: [webApp] },
        ),
      },
    );

    const { exitCode, stdout, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      "GET /v1/projects",
      "GET /v1/projects",
      "GET /v1/projects",
    ]);
    expect(requestedWaits).toEqual([23_000, 23_000, 23_000]);
    expect(stderr).toEqual(
      waitingTwentyThreeSecondsLine +
        waitingTwentyThreeSecondsLine +
        waitingTwentyThreeSecondsLine +
        `Error: The Admin API kept refusing the request after three waits. ${organizationRequestRateLimitSentence}\n`,
    );
    expect(stdout).toEqual("");
  });

  it("exit 2 with the API's sentence after one request when the request rate limit comes without Retry-After", async () => {
    const adminApi = await startStubAdminApi(requestRateLimitReached({}));

    const { exitCode, stdout, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
    expect(requestedWaits).toEqual([]);
    expect(stderr).toEqual(`Error: ${organizationRequestRateLimitSentence}\n`);
    expect(stdout).toEqual("");
  });

  it("exit 2 with the API's sentence after one request when the request rate limit's Retry-After is 'soon'", async () => {
    const adminApi = await startStubAdminApi(requestRateLimitReached({ "retry-after": "soon" }));

    const { exitCode, stdout, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
    expect(requestedWaits).toEqual([]);
    expect(stderr).toEqual(`Error: ${organizationRequestRateLimitSentence}\n`);
    expect(stdout).toEqual("");
  });

  it("exit 2 with the API's sentence after one request when the request rate limit's Retry-After is 600 seconds", async () => {
    const adminApi = await startStubAdminApi(requestRateLimitReached({ "retry-after": "600" }));

    const { exitCode, stdout, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
    expect(requestedWaits).toEqual([]);
    expect(stderr).toEqual(`Error: ${organizationRequestRateLimitSentence}\n`);
    expect(stdout).toEqual("");
  });

  it("exit 2 with the API's sentence after one request when the request rate limit's Retry-After is 61 seconds", async () => {
    const adminApi = await startStubAdminApi(requestRateLimitReached({ "retry-after": "61" }));

    const { exitCode, stdout, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
    expect(requestedWaits).toEqual([]);
    expect(stderr).toEqual(`Error: ${organizationRequestRateLimitSentence}\n`);
    expect(stdout).toEqual("");
  });

  it("exit 2 with the API's sentence after one request when the request rate limit's Retry-After is 0 seconds", async () => {
    const adminApi = await startStubAdminApi(requestRateLimitReached({ "retry-after": "0" }));

    const { exitCode, stdout, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
    expect(requestedWaits).toEqual([]);
    expect(stderr).toEqual(`Error: ${organizationRequestRateLimitSentence}\n`);
    expect(stdout).toEqual("");
  });

  it("exit 2 with the API's sentence after one request when the request rate limit's Retry-After is not a whole number of seconds", async () => {
    const adminApi = await startStubAdminApi(requestRateLimitReached({ "retry-after": "2.5" }));

    const { exitCode, stdout, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
    expect(requestedWaits).toEqual([]);
    expect(stderr).toEqual(`Error: ${organizationRequestRateLimitSentence}\n`);
    expect(stdout).toEqual("");
  });

  it("wait one second, saying so in the singular, when the request rate limit's Retry-After is 1", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/projects": firstReplyThen(requestRateLimitReached({ "retry-after": "1" }), {
          status: 200,
          body: [webApp],
        }),
      },
    );

    const { exitCode, stderr, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(requestedWaits).toEqual([1_000]);
    expect(stderr).toEqual(
      "The Admin API's request rate limit was reached. Waiting 1 second before trying again.\n",
    );
  });

  it("wait sixty seconds when the request rate limit's Retry-After is 60", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/projects": firstReplyThen(requestRateLimitReached({ "retry-after": "60" }), {
          status: 200,
          body: [webApp],
        }),
      },
    );

    const { exitCode, requestedWaits } = await runInit(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(requestedWaits).toEqual([60_000]);
  });

  it("leave stdout to the command's JSON with --json after a wait", async () => {
    const adminApi = await startStubAdminApi(
      { status: 404, body: {} },
      {
        "/v1/projects": firstReplyThen(requestRateLimitReached({ "retry-after": "23" }), {
          status: 200,
          body: [webApp],
        }),
      },
    );
    const invocation = (await createSandbox()).invocation({
      commandLineArguments: ["projects", "list", "--json", "--token", "cd_flag_token"],
      environmentVariables: { CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl },
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(JSON.parse(invocation.stdout.text())).toEqual([webApp]);
    expect(invocation.stderr.text()).toEqual(waitingTwentyThreeSecondsLine);
  });
});
