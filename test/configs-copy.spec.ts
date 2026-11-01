import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import {
  configNotFound,
  projectPath,
  requestLinesOf,
  startBrowseAdminApi,
} from "./support/browse-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";
import type { StubReply } from "./support/stub-admin-api.js";

const mobileApp = {
  ...webApp,
  id: "2c4e6a8b-1d3f-4a5b-9c7d-8e0f2a4b6c8d",
  name: "Mobile App",
  slug: "mobile-app",
};

const copyPath = projectPath("/configs/new-checkout/copy");

const startCopyAdminApi = (copyReply: StubReply) =>
  startBrowseAdminApi({ "/configs/new-checkout/copy": copyReply }, [webApp, mobileApp]);

const copyConfig = async (baseUrl: string, commandLineArguments: string[]) => {
  const invocation = (await createSandbox()).invocation({
    commandLineArguments: [
      "configs",
      "copy",
      ...commandLineArguments,
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const copyBodies = (adminApi: Awaited<ReturnType<typeof startCopyAdminApi>>) =>
  adminApi.receivedRequests
    .filter((request) => request.method === "POST" && request.path === copyPath)
    .map((request) => request.body);

const sameProjectPlan = {
  environments: [
    { slug: "test", live: false, sourceSlug: "test", rulesCopied: 1, droppedRules: [] },
    { slug: "production", live: true, sourceSlug: "production", rulesCopied: 2, droppedRules: [] },
  ],
  skippedSourceEnvironments: [],
  tags: { matched: ["checkout"], created: [], skipped: [] },
};

const copiedConfig = (key: string, projectId: string) => ({
  id: "config-copy",
  projectId,
  key,
  role: "flag",
  lifetime: "temporary",
  type: "boolean",
  state: "new",
  server: true,
  client: true,
  variations: [],
  deprecatedKeys: [],
  tags: [],
  targets: [],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
});

describe("configs copy", () => {
  it("copies a config within its project and prints the plan and the new key", async () => {
    const adminApi = await startCopyAdminApi({
      status: 201,
      body: { plan: sameProjectPlan, config: copiedConfig("new-checkout-copy", webApp.id) },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout-copy",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Copied new-checkout in web-app to new-checkout-copy in web-app.",
      "Environments:",
      "  test                from test         1 rule copied",
      "  production (live)   from production   2 rules copied",
      "Tags:",
      "  checkout   matched",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${copyPath}`]);
    expect(copyBodies(adminApi)).toEqual([
      { projectId: webApp.id, key: "new-checkout-copy", environments: {}, dryRun: false },
    ]);
  });

  it("sends the id of the project --to names as the destination, found in the same project listing", async () => {
    const adminApi = await startCopyAdminApi({
      status: 201,
      body: { plan: sameProjectPlan, config: copiedConfig("new-checkout", mobileApp.id) },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")[0]).toEqual("Copied new-checkout in web-app to new-checkout in mobile-app.");
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${copyPath}`]);
    expect(copyBodies(adminApi)).toEqual([
      { projectId: mobileApp.id, key: "new-checkout", environments: {}, dryRun: false },
    ]);
  });

  it("sends each --environment as a destination slug mapped to a source slug", async () => {
    const adminApi = await startCopyAdminApi({
      status: 201,
      body: { plan: sameProjectPlan, config: copiedConfig("new-checkout", mobileApp.id) },
    });

    const { exitCode, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
      "--environment",
      "qa=test",
      "--environment",
      "beta=production",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(copyBodies(adminApi)).toEqual([
      {
        projectId: mobileApp.id,
        key: "new-checkout",
        environments: { qa: "test", beta: "production" },
        dryRun: false,
      },
    ]);
  });

  it("prints each rule the copy dropped on its environment's line, with its position and segment key", async () => {
    const adminApi = await startCopyAdminApi({
      status: 201,
      body: {
        plan: {
          environments: [
            {
              slug: "production",
              live: true,
              sourceSlug: "production",
              rulesCopied: 1,
              droppedRules: [
                { position: 1, segmentKey: "beta-testers" },
                { position: 3, segmentKey: "vip-customers" },
              ],
            },
            { slug: "qa", live: false, sourceSlug: "test", rulesCopied: 0, droppedRules: [] },
          ],
          skippedSourceEnvironments: [],
          tags: { matched: [], created: [], skipped: [] },
        },
        config: copiedConfig("new-checkout", mobileApp.id),
      },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
      "--environment",
      "qa=test",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Copied new-checkout in web-app to new-checkout in mobile-app.",
      "Environments:",
      "  production (live)   from production   1 rule copied    " +
        "rule 1 dropped: mobile-app has no segment beta-testers; " +
        "rule 3 dropped: mobile-app has no segment vip-customers",
      "  qa                  from test         0 rules copied",
      "",
    ]);
  });

  it("prints a skipped source environment the destination project has no environment for", async () => {
    const adminApi = await startCopyAdminApi({
      status: 201,
      body: {
        plan: {
          environments: [
            { slug: "production", live: true, sourceSlug: "production", rulesCopied: 2, droppedRules: [] },
          ],
          skippedSourceEnvironments: ["test"],
          tags: { matched: [], created: [], skipped: [] },
        },
        config: copiedConfig("new-checkout", mobileApp.id),
      },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Copied new-checkout in web-app to new-checkout in mobile-app.",
      "Environments:",
      "  production (live)   from production   2 rules copied",
      "Skipped source environments:",
      "  test   mobile-app has no environment with this slug; create it there to copy its rules",
      "",
    ]);
  });

  it("prints a skipped source environment whose namesake in the destination project copies another source", async () => {
    const adminApi = await startCopyAdminApi({
      status: 201,
      body: {
        plan: {
          environments: [
            { slug: "production", live: true, sourceSlug: "test", rulesCopied: 1, droppedRules: [] },
          ],
          skippedSourceEnvironments: ["production"],
          tags: { matched: [], created: [], skipped: [] },
        },
        config: copiedConfig("new-checkout", mobileApp.id),
      },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
      "--environment",
      "production=test",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Copied new-checkout in web-app to new-checkout in mobile-app.",
      "Environments:",
      "  production (live)   from test   1 rule copied",
      "Skipped source environments:",
      "  production   production in mobile-app copies from test instead; " +
        "--environment production=production copies this one",
      "",
    ]);
  });

  it("prints the tags the copy matched, created and skipped, with the reason for a skipped tag", async () => {
    const adminApi = await startCopyAdminApi({
      status: 201,
      body: {
        plan: {
          environments: [
            { slug: "production", live: true, sourceSlug: "production", rulesCopied: 2, droppedRules: [] },
          ],
          skippedSourceEnvironments: [],
          tags: { matched: ["search"], created: ["growth"], skipped: ["beta"] },
        },
        config: copiedConfig("new-checkout", mobileApp.id),
      },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Copied new-checkout in web-app to new-checkout in mobile-app.",
      "Environments:",
      "  production (live)   from production   2 rules copied",
      "Tags:",
      "  search   matched",
      "  growth   created",
      "  beta     skipped: the API token cannot create tags",
      "",
    ]);
  });

  it("sends dryRun true with --dry-run and prints the plan as what would happen, saying nothing was created", async () => {
    const adminApi = await startCopyAdminApi({
      status: 200,
      body: {
        plan: {
          environments: [
            {
              slug: "production",
              live: true,
              sourceSlug: "production",
              rulesCopied: 1,
              droppedRules: [{ position: 2, segmentKey: "beta-testers" }],
            },
          ],
          skippedSourceEnvironments: ["test"],
          tags: { matched: ["search"], created: ["growth"], skipped: ["beta"] },
        },
      },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
      "--dry-run",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Nothing was created: this is the plan for copying new-checkout in web-app to new-checkout in mobile-app.",
      "Environments:",
      "  production (live)   from production   1 rule would be copied   " +
        "rule 2 would be dropped: mobile-app has no segment beta-testers",
      "Source environments that would be skipped:",
      "  test   mobile-app has no environment with this slug; create it there to copy its rules",
      "Tags:",
      "  search   matched",
      "  growth   would be created",
      "  beta     would be skipped: the API token cannot create tags",
      "",
    ]);
    expect(copyBodies(adminApi)).toEqual([
      { projectId: mobileApp.id, key: "new-checkout", environments: {}, dryRun: true },
    ]);
  });

  it("prints the response as received and nothing else with --json", async () => {
    const response = {
      plan: sameProjectPlan,
      config: copiedConfig("new-checkout-copy", webApp.id),
      addedByALaterApi: { reason: "kept" },
    };
    const adminApi = await startCopyAdminApi({ status: 201, body: response });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout-copy",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual(response);
  });

  it("exits 2 with the API's field message when a destination environment has no source environment", async () => {
    const adminApi = await startCopyAdminApi({
      status: 400,
      body: {
        errors: [
          {
            name: "environments.qa",
            message:
              'No environment of the source config has the slug "qa". ' +
              'Name the source environment whose rules it starts with in "environments".',
          },
        ],
      },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        '  environments.qa: No environment of the source config has the slug "qa". ' +
        'Name the source environment whose rules it starts with in "environments".\n',
    );
  });

  it("exits 2 with the API's field message, and no second request, when the key is taken", async () => {
    const adminApi = await startCopyAdminApi({
      status: 400,
      body: {
        errors: [
          {
            name: "key",
            message: "The key is already in use in the current project, please use a different key",
          },
        ],
      },
    });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "checkout-banner",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  key: The key is already in use in the current project, please use a different key\n",
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects", `POST ${copyPath}`]);
  });

  it("exits 2 saying no config has the key when the API answers 404 with CONFIG_NOT_FOUND", async () => {
    const adminApi = await startCopyAdminApi(configNotFound("new-checkout"));

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout-copy",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-checkout".\n');
  });

  it("exits 2 without copying when no project of the organization has the --to slug", async () => {
    const adminApi = await startCopyAdminApi({ status: 500 });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "android-app",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No project in the API token\'s organization has the slug "android-app".\n',
    );
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/projects"]);
  });

  it("exits 2 without a request when --key is missing", async () => {
    const adminApi = await startCopyAdminApi({ status: 500 });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--to",
      "mobile-app",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--key <key>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when an --environment has no source slug after =", async () => {
    const adminApi = await startCopyAdminApi({ status: 500 });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
      "--environment",
      "qa=",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --environment takes <destination slug>=<source slug>, not qa=.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when an --environment has no =", async () => {
    const adminApi = await startCopyAdminApi({ status: 500 });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
      "--environment",
      "qa",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual("Error: --environment takes <destination slug>=<source slug>, not qa.\n");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --environment maps a destination environment twice, ignoring case", async () => {
    const adminApi = await startCopyAdminApi({ status: 500 });

    const { exitCode, stdout, stderr } = await copyConfig(adminApi.baseUrl, [
      "new-checkout",
      "--key",
      "new-checkout",
      "--to",
      "mobile-app",
      "--environment",
      "qa=test",
      "--environment",
      "QA=production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: --environment maps the destination environment "QA" more than once. Case doesn\'t matter in slugs.\n',
    );
    expect(adminApi.receivedRequests).toEqual([]);
  });
});
