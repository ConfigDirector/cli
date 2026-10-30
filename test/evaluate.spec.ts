import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import {
  evaluationOf,
  productionEnvironment,
  startEvaluateAdminApi,
  targetingRulesOf,
} from "./support/evaluate-admin-api.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { webApp } from "./support/scan-admin-api.js";

const evaluateIn = async (sandbox: Sandbox, baseUrl: string, commandLineArguments: string[]) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "evaluate",
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

const evaluate = async (baseUrl: string, commandLineArguments: string[]) =>
  evaluateIn(await createSandbox(), baseUrl, commandLineArguments);

const firstLine = (text: string) => text.split("\n")[0];

const packageVersion = async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version as string;
};

const evaluateRequestBodies = (adminApi: Awaited<ReturnType<typeof startEvaluateAdminApi>>) =>
  adminApi.receivedRequests.filter((request) => request.method === "POST").map((request) => request.body);

describe("evaluate", () => {
  it("sends an inline context with string traits and traits typed with := as JSON", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-kind",
      "account",
      "--context-id",
      "123",
      "--context-name",
      "Ada",
      "--context-trait",
      "plan=pro",
      "--context-trait",
      "beta:=true",
      "--context-trait",
      "age:=30",
      "--context-trait",
      "referrer=https://example.com/?a=b",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(adminApi.receivedRequests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /v1/projects",
      `GET /v1/projects/${webApp.id}/environments`,
      `POST /v1/projects/${webApp.id}/configs/new-checkout/evaluate`,
    ]);
    expect(evaluateRequestBodies(adminApi)).toEqual([
      {
        environmentId: productionEnvironment.id,
        context: {
          kind: "account",
          identifier: "123",
          name: "Ada",
          traits: { plan: "pro", beta: true, age: 30, referrer: "https://example.com/?a=b" },
        },
      },
    ]);
  });

  it("sends the evaluation request as JSON with the bearer token, the cli source client and the CLI's user agent", async () => {
    const adminApi = await startEvaluateAdminApi();

    await evaluate(adminApi.baseUrl, ["new-checkout", "--environment", "production"]);

    const evaluateRequest = adminApi.receivedRequests.find((request) => request.method === "POST");
    expect({
      contentType: evaluateRequest?.headers["content-type"],
      authorization: evaluateRequest?.headers.authorization,
      sourceClient: evaluateRequest?.headers["x-sourceclient"],
      userAgent: evaluateRequest?.headers["user-agent"],
    }).toEqual({
      contentType: "application/json",
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
      userAgent: `configdirector-cli/${await packageVersion()}`,
    });
  });

  it("sends the context given as JSON with --context-json as it is", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-json",
      '{ "identifier": "123", "traits": { "address": { "country": "NZ" } } }',
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(evaluateRequestBodies(adminApi)).toEqual([
      {
        environmentId: productionEnvironment.id,
        context: { identifier: "123", traits: { address: { country: "NZ" } } },
      },
    ]);
  });

  it("sends the context read from the file named by --context-json @file", async () => {
    const adminApi = await startEvaluateAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(
      sandbox.workingDirectory,
      "contexts/ada.json",
      '{ "kind": "user", "identifier": "123", "name": "Ada" }\n',
    );

    const { exitCode, stderr } = await evaluateIn(sandbox, adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-json",
      "@contexts/ada.json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(evaluateRequestBodies(adminApi)).toEqual([
      {
        environmentId: productionEnvironment.id,
        context: { kind: "user", identifier: "123", name: "Ada" },
      },
    ]);
  });

  it("sends the kind and identifier of --saved-context as savedContext and names it as a saved context", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--saved-context",
      "user:123",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(firstLine(stdout)).toEqual("new-checkout in Production for saved context user 123");
    expect(evaluateRequestBodies(adminApi)).toEqual([
      { environmentId: productionEnvironment.id, savedContext: { kind: "user", identifier: "123" } },
    ]);
  });

  it("evaluates for an empty context when no context option is given and says the context was empty", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: { status: 200, body: evaluationOf({ context: null }) },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(firstLine(stdout)).toEqual("new-checkout in Production for an empty context");
    expect(evaluateRequestBodies(adminApi)).toEqual([{ environmentId: productionEnvironment.id }]);
  });

  it("evaluates in the project linked by configdirector.json when no project is named", async () => {
    const adminApi = await startEvaluateAdminApi();
    const sandbox = await createSandbox();
    const environmentVariables = {
      CONFIGDIRECTOR_BASE_URL: adminApi.baseUrl,
      CONFIGDIRECTOR_TOKEN: "cd_env_token",
    };
    await run(
      sandbox.invocation({ commandLineArguments: ["init", "--project", "web-app"], environmentVariables }),
    );
    const invocation = sandbox.invocation({
      commandLineArguments: ["evaluate", "new-checkout", "--environment", "production"],
      environmentVariables,
    });

    const exitCode = await run(invocation);

    expect(exitCode).toEqual(0);
    expect(invocation.stderr.text()).toEqual("");
    expect(adminApi.receivedRequests.at(-1)?.path).toEqual(
      `/v1/projects/${webApp.id}/configs/new-checkout/evaluate`,
    );
  });

  it("prints the API's response as received and nothing else with --json", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: { status: 200, body: evaluationOf({ addedByALaterApi: { reason: "kept" } }) },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-id",
      "123",
      "--json",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual(evaluationOf({ addedByALaterApi: { reason: "kept" } }));
  });
});

const segmentOf = (id: string, key: string, name: string) => ({
  id,
  projectId: webApp.id,
  key,
  name,
  kind: "rule-based",
  groups: [
    [
      {
        id: `${id}-condition`,
        kind: "attribute",
        attribute: "traits",
        trait: "/email",
        operator: "ends with any of",
        targetType: "text",
        targetValues: ["@example.com"],
      },
    ],
  ],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
});

const traitCondition = (id: string, trait: string, operator: string, targetValues: string[]) => ({
  id,
  kind: "attribute",
  attribute: "traits",
  trait,
  operator,
  targetType: operator === ">=" ? "number" : "text",
  targetValues,
});

const everyOutcomeEvaluation = evaluationOf({
  context: { kind: "user", identifier: "123", name: "Ada", traits: { plan: "free", country: "NZ" } },
  value: "true",
  servedBy: { kind: "rule", ruleId: "rule-5" },
  rules: [
    {
      ruleId: "rule-1",
      outcome: "not-matched",
      conditions: [],
      bucket: {
        identifier: "123",
        defaultedToPredefinedBucket: false,
        assignedPercentage: 71.34,
        shares: [{ percentageId: "share-1", from: 0, to: 50, value: "true" }],
      },
    },
    {
      ruleId: "rule-2",
      outcome: "not-matched",
      conditions: [
        {
          conditionId: "condition-plan-pro",
          kind: "attribute",
          outcome: "not-matched",
          resolvedValue: "free",
          resolvedType: "scalar",
        },
        { conditionId: "condition-country", outcome: "not-evaluated" },
      ],
    },
    { ruleId: "rule-3", outcome: "errored", conditions: [] },
    {
      ruleId: "rule-4",
      outcome: "not-matched",
      conditions: [
        {
          conditionId: "condition-beta",
          kind: "segment",
          outcome: "not-matched",
          segmentId: "segment-beta",
          segmentFound: true,
        },
      ],
    },
    {
      ruleId: "rule-5",
      outcome: "matched",
      conditions: [
        {
          conditionId: "condition-plan-free",
          kind: "attribute",
          outcome: "matched",
          resolvedValue: "free",
          resolvedType: "scalar",
        },
        {
          conditionId: "condition-internal",
          kind: "segment",
          outcome: "matched",
          segmentId: "segment-internal",
          segmentFound: true,
        },
      ],
      bucket: {
        identifier: "123",
        defaultedToPredefinedBucket: false,
        assignedPercentage: 32.08,
        shares: [
          { percentageId: "share-5-true", from: 0, to: 50, value: "true" },
          { percentageId: "share-5-false", from: 50, to: 100, value: "false" },
        ],
        selectedPercentageId: "share-5-true",
      },
    },
    { ruleId: "rule-6", outcome: "not-evaluated", conditions: [] },
  ],
  targetingRules: targetingRulesOf([
    {
      id: "rule-1",
      type: "percentage",
      target: "percentage",
      order: 0,
      percentages: [{ id: "share-1", percentage: 50, value: true }],
    },
    {
      id: "rule-2",
      type: "conditional",
      order: 1,
      conditions: [
        traitCondition("condition-plan-pro", "/plan", "is one of", ["pro", "team"]),
        traitCondition("condition-country", "/country", "equals", ["US"]),
      ],
      target: "value",
      value: true,
      percentages: [],
    },
    {
      id: "rule-3",
      type: "conditional",
      order: 2,
      conditions: [traitCondition("condition-age", "/age", ">=", ["18"])],
      target: "value",
      value: true,
      percentages: [],
    },
    {
      id: "rule-4",
      type: "conditional",
      order: 3,
      conditions: [{ id: "condition-beta", kind: "segment", operator: "in", segmentId: "segment-beta" }],
      target: "value",
      value: true,
      percentages: [],
    },
    {
      id: "rule-5",
      type: "conditional",
      order: 4,
      conditions: [
        traitCondition("condition-plan-free", "/plan", "is one of", ["free"]),
        { id: "condition-internal", kind: "segment", operator: "not in", segmentId: "segment-internal" },
      ],
      target: "percentage",
      percentages: [
        { id: "share-5-true", percentage: 50, value: true },
        { id: "share-5-false", percentage: 50, value: false },
      ],
    },
    {
      id: "rule-6",
      type: "percentage",
      target: "percentage",
      order: 5,
      percentages: [{ id: "share-6", percentage: 100, value: false }],
    },
  ]),
  segments: {
    "segment-beta": segmentOf("segment-beta", "beta-testers", "Beta testers"),
    "segment-internal": segmentOf("segment-internal", "internal", "Internal"),
  },
});

describe("evaluate output", () => {
  it("shows the value, the rule that served it and what each rule tested with its outcome", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: { status: 200, body: everyOutcomeEvaluation },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-id",
      "123",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout in Production for user 123",
      "",
      "true, served by rule 5",
      "",
      "1. 50% get true                                                                   not matched: bucket 71.3 is outside 0 to 50",
      '2. plan is one of pro, team and country equals US: true                           not matched: plan is one of pro, team, but it is "free"',
      "3. age >= 18: true                                                                errored",
      "4. in segment Beta testers: true                                                  not matched: in segment Beta testers, but no group matched",
      "5. plan is one of free and not in segment Internal: 50% get true, 50% get false   matched: bucket 32.1 is in 0 to 50",
      "6. 100% get false                                                                 not evaluated",
      "Default targeting rule: false",
      "",
    ]);
  });

  it("exits 0 saying the value was served by the default targeting rule when no rule matched, with an absent trait", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 200,
        body: evaluationOf({
          context: { kind: "user", identifier: "456", name: null, traits: null },
          value: "false",
          servedBy: { kind: "default" },
          rules: [
            {
              ruleId: "rule-pro",
              outcome: "not-matched",
              conditions: [
                {
                  conditionId: "condition-plan",
                  kind: "attribute",
                  outcome: "not-matched",
                  resolvedType: "absent",
                },
              ],
            },
          ],
          targetingRules: targetingRulesOf([
            {
              id: "rule-pro",
              type: "conditional",
              order: 0,
              conditions: [traitCondition("condition-plan", "/plan", "is one of", ["pro"])],
              target: "value",
              value: true,
              percentages: [],
            },
          ]),
        }),
      },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-id",
      "456",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout in Production for user 456",
      "",
      "false, served by the default targeting rule",
      "",
      "1. plan is one of pro: true   not matched: plan is one of pro, but it is absent",
      "Default targeting rule: false",
      "",
    ]);
  });

  it("says a context without an identifier gets bucket 0 in a percentage rule", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 200,
        body: evaluationOf({
          context: { kind: "device", identifier: null, name: null, traits: null },
          value: "true",
          servedBy: { kind: "rule", ruleId: "rule-rollout" },
          rules: [
            {
              ruleId: "rule-rollout",
              outcome: "matched",
              conditions: [],
              bucket: {
                defaultedToPredefinedBucket: true,
                assignedPercentage: 0,
                shares: [
                  { percentageId: "share-true", from: 0, to: 30, value: "true" },
                  { percentageId: "share-false", from: 30, to: 100, value: "false" },
                ],
                selectedPercentageId: "share-true",
              },
            },
          ],
          targetingRules: targetingRulesOf([
            {
              id: "rule-rollout",
              type: "percentage",
              target: "percentage",
              order: 0,
              percentages: [
                { id: "share-true", percentage: 30, value: true },
                { id: "share-false", percentage: 70, value: false },
              ],
            },
          ]),
        }),
      },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-kind",
      "device",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "new-checkout in Production for a device context without an identifier",
      "",
      "true, served by rule 1",
      "",
      "1. 30% get true, 70% get false   matched: no identifier, so bucket 0.0 is in 0 to 30",
      "Default targeting rule: false",
      "",
    ]);
  });

  it("names the group that matched when a not in segment condition fails", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 200,
        body: evaluationOf({
          value: "false",
          servedBy: { kind: "default" },
          rules: [
            {
              ruleId: "rule-not-internal",
              outcome: "not-matched",
              conditions: [
                {
                  conditionId: "condition-internal",
                  kind: "segment",
                  outcome: "not-matched",
                  segmentId: "segment-internal",
                  segmentFound: true,
                  matchedGroupIndex: 1,
                },
              ],
            },
          ],
          targetingRules: targetingRulesOf([
            {
              id: "rule-not-internal",
              type: "conditional",
              order: 0,
              conditions: [
                {
                  id: "condition-internal",
                  kind: "segment",
                  operator: "not in",
                  segmentId: "segment-internal",
                },
              ],
              target: "value",
              value: true,
              percentages: [],
            },
          ]),
          segments: { "segment-internal": segmentOf("segment-internal", "internal", "Internal") },
        }),
      },
    });

    const { stdout } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-id",
      "123",
    ]);

    expect(stdout.split("\n")[4]).toEqual(
      "1. not in segment Internal: true   not matched: not in segment Internal, but group 2 matched",
    );
  });

  it("says a segment was not found when the evaluator had no definition of it", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 200,
        body: evaluationOf({
          value: "false",
          servedBy: { kind: "default" },
          rules: [
            {
              ruleId: "rule-deleted-segment",
              outcome: "not-matched",
              conditions: [
                {
                  conditionId: "condition-deleted",
                  kind: "segment",
                  outcome: "not-matched",
                  segmentId: "segment-deleted",
                  segmentFound: false,
                },
              ],
            },
          ],
          targetingRules: targetingRulesOf([
            {
              id: "rule-deleted-segment",
              type: "conditional",
              order: 0,
              conditions: [
                { id: "condition-deleted", kind: "segment", operator: "in", segmentId: "segment-deleted" },
              ],
              target: "value",
              value: true,
              percentages: [],
            },
          ]),
        }),
      },
    });

    const { stdout } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-id",
      "123",
    ]);

    expect(stdout.split("\n")[4]).toEqual(
      "1. in segment segment-deleted: true   not matched: in segment segment-deleted, but the segment was not found",
    );
  });

  it("names the context's identifier, kind and name and the app's name and version in conditions", async () => {
    const attributeCondition = (id: string, attribute: string, operator: string, targetValues: string[]) => ({
      id,
      kind: "attribute",
      attribute,
      operator,
      targetType: attribute === "appVersion" ? "semver" : "text",
      targetValues,
    });
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 200,
        body: evaluationOf({
          value: "false",
          servedBy: { kind: "default" },
          rules: [
            {
              ruleId: "rule-attributes",
              outcome: "not-matched",
              conditions: [
                {
                  conditionId: "condition-identifier",
                  kind: "attribute",
                  outcome: "matched",
                  resolvedValue: "123",
                  resolvedType: "scalar",
                },
                {
                  conditionId: "condition-kind",
                  kind: "attribute",
                  outcome: "matched",
                  resolvedValue: "user",
                  resolvedType: "scalar",
                },
                {
                  conditionId: "condition-name",
                  kind: "attribute",
                  outcome: "matched",
                  resolvedValue: "Ada",
                  resolvedType: "scalar",
                },
                {
                  conditionId: "condition-app-name",
                  kind: "attribute",
                  outcome: "not-matched",
                  resolvedType: "absent",
                },
                { conditionId: "condition-app-version", outcome: "not-evaluated" },
              ],
            },
          ],
          targetingRules: targetingRulesOf([
            {
              id: "rule-attributes",
              type: "conditional",
              order: 0,
              conditions: [
                attributeCondition("condition-identifier", "identifier", "is one of", ["123", "456"]),
                attributeCondition("condition-kind", "kind", "equals", ["user"]),
                attributeCondition("condition-name", "name", "starts with any of", ["A"]),
                attributeCondition("condition-app-name", "appName", "equals", ["checkout-web"]),
                attributeCondition("condition-app-version", "appVersion", ">=", ["2.0.0"]),
              ],
              target: "value",
              value: true,
              percentages: [],
            },
          ]),
        }),
      },
    });

    const { stdout } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-id",
      "123",
    ]);

    expect(stdout.split("\n")[4]).toEqual(
      "1. context identifier is one of 123, 456 and context kind equals user and context name starts with any of A " +
        "and app name equals checkout-web and app version >= 2.0.0: true   not matched: app name equals checkout-web, but it is absent",
    );
  });

  it("says the key given is an old key of the config's current key before the evaluation", async () => {
    const adminApi = await startEvaluateAdminApi({ key: "checkout-v2" });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "checkout-v2",
      "--environment",
      "production",
      "--context-id",
      "123",
    ]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "checkout-v2 is an old key of new-checkout.",
      "new-checkout in Production for user 123",
    ]);
  });
});

describe("evaluate usage errors", () => {
  it("exits 2 without a request when --saved-context is combined with an inline context option", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--saved-context",
      "user:123",
      "--context-trait",
      "plan=pro",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--saved-context cannot be combined with --context-trait");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --saved-context is combined with --context-json", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--saved-context",
      "user:123",
      "--context-json",
      '{ "identifier": "123" }',
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--saved-context cannot be combined with --context-json");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --context-json is combined with an inline context option", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-json",
      '{ "identifier": "123" }',
      "--context-kind",
      "account",
      "--context-id",
      "456",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--context-json cannot be combined with --context-kind, --context-id");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --environment is missing", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, ["new-checkout"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--environment <slug>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when the key is missing", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, ["--environment", "production"]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("missing required argument 'key'");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when a --context-trait has no =", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-trait",
      "plan",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--context-trait plan is not a trait");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when the value of a --context-trait after := is not JSON", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-trait",
      "plan:=pro",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--context-trait plan:=pro has a value after := that is not JSON");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --saved-context has no kind before a colon", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--saved-context",
      "123",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--saved-context takes <kind>:<identifier>");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --context-json is not a JSON object", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-json",
      '["user", "123"]',
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--context-json takes the context as a JSON object");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when the file named by --context-json @file does not exist", async () => {
    const adminApi = await startEvaluateAdminApi();
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await evaluateIn(sandbox, adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--context-json",
      "@contexts/missing.json",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(join(sandbox.workingDirectory, "contexts", "missing.json"));
    expect(adminApi.receivedRequests).toEqual([]);
  });
});

describe("evaluate failures", () => {
  it("exits 2 listing the project's environment slugs when no environment has the slug given", async () => {
    const adminApi = await startEvaluateAdminApi();

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "prod",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain('No environment in web-app has the slug "prod"');
    expect(stderr).toContain("test, production");
    expect(evaluateRequestBodies(adminApi)).toEqual([]);
  });

  it("exits 2 saying the project has no environments when it has none", async () => {
    const adminApi = await startEvaluateAdminApi({ environments: [] });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No environment in web-app has the slug "production". The project has no environments.\n',
    );
    expect(evaluateRequestBodies(adminApi)).toEqual([]);
  });

  it("exits 2 saying no config in the project has the key when the API answers CONFIG_NOT_FOUND", async () => {
    const adminApi = await startEvaluateAdminApi({
      key: "new-chekout",
      evaluateReply: {
        status: 404,
        body: { error: "No config with the given key exists in the project.", code: "CONFIG_NOT_FOUND" },
      },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-chekout",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-chekout".\n');
  });

  it("exits 2 naming the environment when the API answers ENVIRONMENT_NOT_FOUND", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 404,
        body: {
          error: "No environment with the given id exists in the project.",
          code: "ENVIRONMENT_NOT_FOUND",
        },
      },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No environment in web-app has the slug "production" any more.\n');
  });

  it("exits 2 naming the context kind, the identifier and the environment when the API answers CONTEXT_NOT_FOUND", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 404,
        body: {
          error: "No saved context with the given kind and identifier exists in the environment.",
          code: "CONTEXT_NOT_FOUND",
        },
      },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--saved-context",
      "account:acme",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No context saved in production has the context kind account and the identifier "acme".\n',
    );
  });

  it("exits 2 showing the API's sentence when the API answers a not-found code evaluate has no message for", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 404,
        body: {
          error: `No project with id '${webApp.id}' exists in the organization.`,
          code: "PROJECT_NOT_FOUND",
        },
      },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(`No project with id '${webApp.id}' exists in the organization.`);
  });

  it("exits 2 showing the status when a 404 comes without a code", async () => {
    const adminApi = await startEvaluateAdminApi({ evaluateReply: { status: 404, body: {} } });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("HTTP 404");
  });

  it("exits 2 naming contexts:read when the token cannot evaluate for a saved context", async () => {
    const adminApi = await startEvaluateAdminApi({
      evaluateReply: {
        status: 403,
        body: {
          error: "The API token is missing the `contexts:read` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await evaluate(adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--saved-context",
      "user:123",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("contexts:read");
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
  });
});
