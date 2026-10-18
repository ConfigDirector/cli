import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { projectPath, requestLinesOf, startBrowseAdminApi } from "./support/browse-admin-api.js";
import { productionEnvironment, testEnvironment } from "./support/evaluate-admin-api.js";
import { writeRepositoryFile } from "./support/repository-files.js";
import { createSandbox, type Sandbox } from "./support/sandbox.js";
import { startStubAdminApi } from "./support/stub-admin-api.js";

const setTargetingRulesIn = async (
  sandbox: Sandbox,
  baseUrl: string,
  commandLineArguments: string[],
  stdin?: Readable,
) => {
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "targeting-rules",
      "set",
      ...commandLineArguments,
      "--project",
      "web-app",
      "--token",
      "cd_flag_token",
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
    stdin,
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const setTargetingRulesFromFile = async (
  baseUrl: string,
  rulesFile: object,
  commandLineArguments: string[],
) => {
  const sandbox = await createSandbox();
  await writeRepositoryFile(sandbox.workingDirectory, "rules.json", JSON.stringify(rulesFile, null, 2));
  return setTargetingRulesIn(sandbox, baseUrl, [...commandLineArguments, "--rules", "rules.json"]);
};

const targetsPath = (key: string) => `/configs/${key}/targets`;

const putRequestBodies = (adminApi: Awaited<ReturnType<typeof startBrowseAdminApi>>) =>
  adminApi.receivedRequests.filter((request) => request.method === "PUT").map((request) => request.body);

type SentTargetingRules = {
  rules: { id: string; conditions?: { id: string }[]; percentages?: { id: string }[] }[];
};

const uuid = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const planCondition = {
  id: "c1b2c3d4-0000-4000-8000-000000000001",
  kind: "attribute",
  attribute: "traits",
  trait: "/plan",
  operator: "is one of",
  targetType: "text",
  targetValues: ["pro", "team"],
};

const proPlanRule = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  type: "conditional",
  order: 0,
  conditions: [planCondition],
  target: "value",
  value: true,
  valueId: "value-true",
  percentages: [],
};

const rolloutRule = {
  id: "a1b2c3d4-0000-4000-8000-000000000002",
  type: "percentage",
  target: "percentage",
  order: 1,
  percentages: [
    { id: "b1b2c3d4-0000-4000-8000-000000000001", percentage: 30, value: true, valueId: "value-true" },
    { id: "b1b2c3d4-0000-4000-8000-000000000002", percentage: 70, value: false, valueId: "value-false" },
  ],
};

const targetEntryOfConfigsGet = {
  id: "d1b2c3d4-0000-4000-8000-000000000001",
  environment: {
    id: testEnvironment.id,
    name: testEnvironment.name,
    slug: testEnvironment.slug,
    color: testEnvironment.color,
    live: testEnvironment.live,
  },
  rules: [proPlanRule, rolloutRule],
  defaultValue: "false",
  defaultValueId: "value-false",
};

describe("targeting-rules set", () => {
  it("sends a target entry of configs get --json as written, with the id of the environment given, and says what it wrote", async () => {
    const adminApi = await startBrowseAdminApi({ [targetsPath("new-checkout")]: { status: 204 } });

    const { exitCode, stdout, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      targetEntryOfConfigsGet,
      ["new-checkout", "--environment", "production"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Replaced the targeting rules of new-checkout in production with 2 rules and the default targeting rule value false.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/environments")}`,
      `PUT ${projectPath(targetsPath("new-checkout"))}`,
    ]);
    expect(putRequestBodies(adminApi)).toEqual([
      { ...targetEntryOfConfigsGet, environmentId: productionEnvironment.id },
    ]);
  });

  it("gives each rule, condition and percentage without an id a UUID of its own and keeps the ids given", async () => {
    const adminApi = await startBrowseAdminApi({ [targetsPath("new-checkout")]: { status: 204 } });
    const identifierCondition = {
      kind: "attribute",
      attribute: "identifier",
      operator: "is one of",
      targetType: "text",
      targetValues: ["user-101", "user-202"],
    };
    const namedUsersRule = {
      type: "conditional",
      order: 0,
      conditions: [identifierCondition],
      target: "value",
      value: true,
    };
    const keptPercentage = { id: "b1b2c3d4-0000-4000-8000-000000000001", percentage: 30, value: true };
    const newPercentage = { percentage: 70, value: false };

    const { exitCode, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      {
        defaultValue: false,
        rules: [namedUsersRule, { ...rolloutRule, percentages: [keptPercentage, newPercentage] }],
      },
      ["new-checkout", "--environment", "production"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    const [sentBody] = putRequestBodies(adminApi) as [SentTargetingRules];
    expect(sentBody).toEqual({
      defaultValue: false,
      rules: [
        { ...namedUsersRule, id: uuid, conditions: [{ ...identifierCondition, id: uuid }] },
        { ...rolloutRule, percentages: [keptPercentage, { ...newPercentage, id: uuid }] },
      ],
      environmentId: productionEnvironment.id,
    });
    const [namedUsers, rollout] = sentBody.rules;
    expect(
      new Set([namedUsers?.id, namedUsers?.conditions?.[0]?.id, rollout?.percentages?.[1]?.id]).size,
    ).toEqual(3);
  });

  it("reads the rules from stdin for --rules -", async () => {
    const adminApi = await startBrowseAdminApi({ [targetsPath("new-checkout")]: { status: 204 } });
    const rulesJson = JSON.stringify({ defaultValue: "true", rules: [rolloutRule] });
    const stdin = Readable.from([rulesJson.slice(0, 20), rulesJson.slice(20)]);

    const { exitCode, stdout, stderr } = await setTargetingRulesIn(
      await createSandbox(),
      adminApi.baseUrl,
      ["new-checkout", "--environment", "production", "--rules", "-"],
      stdin,
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Replaced the targeting rules of new-checkout in production with 1 rule and the default targeting rule value true.",
      "",
    ]);
    expect(putRequestBodies(adminApi)).toEqual([
      { defaultValue: "true", rules: [rolloutRule], environmentId: productionEnvironment.id },
    ]);
  });

  it("sends the rules as JSON in a PUT with the bearer token and the cli source client", async () => {
    const adminApi = await startBrowseAdminApi({ [targetsPath("new-checkout")]: { status: 204 } });

    await setTargetingRulesFromFile(adminApi.baseUrl, targetEntryOfConfigsGet, [
      "new-checkout",
      "--environment",
      "production",
    ]);

    const putRequest = adminApi.receivedRequests.find((request) => request.method === "PUT");
    expect({
      contentType: putRequest?.headers["content-type"],
      authorization: putRequest?.headers.authorization,
      sourceClient: putRequest?.headers["x-sourceclient"],
    }).toEqual({
      contentType: "application/json",
      authorization: "Bearer cd_flag_token",
      sourceClient: "cli",
    });
  });

  it("prints the body it sent, with the ids it gave, and nothing else with --json", async () => {
    const adminApi = await startBrowseAdminApi({ [targetsPath("new-checkout")]: { status: 204 } });
    const ruleWithoutId = {
      type: "percentage",
      target: "percentage",
      order: 0,
      percentages: [{ id: "b1b2c3d4-0000-4000-8000-000000000003", percentage: 100, value: true }],
    };

    const { exitCode, stdout, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      { defaultValue: "true", rules: [ruleWithoutId] },
      ["new-checkout", "--environment", "production", "--json"],
    );

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({
      defaultValue: "true",
      rules: [{ ...ruleWithoutId, id: uuid }],
      environmentId: productionEnvironment.id,
    });
    expect(JSON.parse(stdout)).toEqual(putRequestBodies(adminApi)[0]);
  });
});

describe("targeting-rules set failures", () => {
  it("exits 2 saying no config in the project has the key when the API answers 404", async () => {
    const adminApi = await startBrowseAdminApi({ [targetsPath("new-chekout")]: { status: 404, body: {} } });

    const { exitCode, stdout, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      targetEntryOfConfigsGet,
      ["new-chekout", "--environment", "production"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "new-chekout".\n');
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/environments")}`,
      `PUT ${projectPath(targetsPath("new-chekout"))}`,
    ]);
  });

  it("exits 2 without sending the rules, listing the project's environment slugs, when no environment has the slug given", async () => {
    const adminApi = await startBrowseAdminApi({ [targetsPath("new-checkout")]: { status: 204 } });

    const { exitCode, stdout, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      targetEntryOfConfigsGet,
      ["new-checkout", "--environment", "prod"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain('No environment in web-app has the slug "prod"');
    expect(stderr).toContain("test, production");
    expect(putRequestBodies(adminApi)).toEqual([]);
  });

  it("exits 2 listing the API's errors when the API rejects the rules", async () => {
    const adminApi = await startBrowseAdminApi({
      [targetsPath("new-checkout")]: {
        status: 400,
        body: {
          errors: [
            { name: "rules.0.id", message: "The rule id must be a valid UUID" },
            { name: "rules.1.percentages", message: "Percentages cannot add up to more than 100" },
          ],
        },
      },
    });

    const { exitCode, stdout, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      targetEntryOfConfigsGet,
      ["new-checkout", "--environment", "production"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n" +
        "  rules.0.id: The rule id must be a valid UUID\n" +
        "  rules.1.percentages: Percentages cannot add up to more than 100\n",
    );
  });

  it("exits 2 naming the missing permission when the token cannot update targeting rules", async () => {
    const adminApi = await startBrowseAdminApi({
      [targetsPath("new-checkout")]: {
        status: 403,
        body: {
          error: "The API token is missing the `config-targeting-rules:update` permission.",
          code: "INSUFFICIENT_PERMISSIONS",
        },
      },
    });

    const { exitCode, stdout, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      targetEntryOfConfigsGet,
      ["new-checkout", "--environment", "production"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("config-targeting-rules:update");
    expect(stderr).toContain("INSUFFICIENT_PERMISSIONS");
  });
});

describe("targeting-rules set usage errors", () => {
  it("exits 2 without a request naming the file when the --rules file does not hold a JSON object", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();
    await writeRepositoryFile(sandbox.workingDirectory, "rules.json", JSON.stringify([proPlanRule]));

    const { exitCode, stdout, stderr } = await setTargetingRulesIn(sandbox, adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--rules",
      "rules.json",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(join(sandbox.workingDirectory, "rules.json"));
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request saying stdin does not hold a JSON object when --rules - reads text that is not JSON", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await setTargetingRulesIn(
      await createSandbox(),
      adminApi.baseUrl,
      ["new-checkout", "--environment", "production", "--rules", "-"],
      Readable.from(["defaultValue: false\n"]),
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("--rules reads stdin, which does not hold a JSON object");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request naming the file when the --rules file does not exist", async () => {
    const adminApi = await startBrowseAdminApi();
    const sandbox = await createSandbox();

    const { exitCode, stdout, stderr } = await setTargetingRulesIn(sandbox, adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
      "--rules",
      "rules/missing.json",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain(join(sandbox.workingDirectory, "rules", "missing.json"));
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --environment is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await setTargetingRulesFromFile(
      adminApi.baseUrl,
      targetEntryOfConfigsGet,
      ["new-checkout"],
    );

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--environment <slug>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });

  it("exits 2 without a request when --rules is missing", async () => {
    const adminApi = await startBrowseAdminApi();

    const { exitCode, stdout, stderr } = await setTargetingRulesIn(await createSandbox(), adminApi.baseUrl, [
      "new-checkout",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toContain("required option '--rules <file>' not specified");
    expect(adminApi.receivedRequests).toEqual([]);
  });
});

const showTargetingRulesReference = async (baseUrl: string, commandLineArguments: string[]) => {
  const sandbox = await createSandbox();
  const invocation = sandbox.invocation({
    commandLineArguments: [
      "targeting-rules",
      "reference",
      ...commandLineArguments,
      "--token",
      "cd_flag_token",
    ],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const targetingRulesReference = {
  targetingRulesSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: { environmentId: { type: "string" }, defaultValue: {}, rules: { type: "array" } },
    required: ["environmentId", "rules"],
  },
  conditionKinds: ["attribute", "segment"],
  operatorsByTargetType: {
    text: ["equals", "does NOT equal", "is one of"],
    number: ["=", "!=", ">"],
    boolean: ["equals"],
  },
  conditionAttributes: ["appName", "identifier", "traits"],
  targetTypes: ["text", "number", "boolean"],
  contextKindOperators: ["equals", "is one of"],
  segmentOperators: ["in", "not in"],
  notes: [
    "A conditional rule needs at least one condition and matches when all of its conditions match.",
    "Text and array operators are case-sensitive: 'is one of' with target 'US' does not match 'us'.",
  ],
};

const startReferenceAdminApi = (reference: object) =>
  startStubAdminApi(
    { status: 404, body: {} },
    { "/v1/targeting-rules-reference": { status: 200, body: reference } },
  );

describe("targeting-rules reference", () => {
  it("prints the notes, then the condition kinds, attributes and operators as lists without the JSON Schema, with no project", async () => {
    const adminApi = await startReferenceAdminApi(targetingRulesReference);

    const { exitCode, stdout, stderr } = await showTargetingRulesReference(adminApi.baseUrl, []);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "A conditional rule needs at least one condition and matches when all of its conditions match.",
      "",
      "Text and array operators are case-sensitive: 'is one of' with target 'US' does not match 'us'.",
      "",
      "Condition kinds:",
      "  attribute",
      "  segment",
      "",
      "Attributes a condition can test:",
      "  appName",
      "  identifier",
      "  traits",
      "",
      "Context kind operators:",
      "  equals",
      "  is one of",
      "",
      "Segment operators:",
      "  in",
      "  not in",
      "",
      "Operators per target type:",
      "  text:",
      "    equals",
      "    does NOT equal",
      "    is one of",
      "  number:",
      "    =",
      "    !=",
      "    >",
      "  boolean:",
      "    equals",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual(["GET /v1/targeting-rules-reference"]);
  });

  it("prints the whole document as received, JSON Schema included, and nothing else with --json", async () => {
    const adminApi = await startReferenceAdminApi({
      ...targetingRulesReference,
      addedByALaterApi: { reason: "kept" },
    });

    const { exitCode, stdout, stderr } = await showTargetingRulesReference(adminApi.baseUrl, ["--json"]);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(JSON.parse(stdout)).toEqual({ ...targetingRulesReference, addedByALaterApi: { reason: "kept" } });
  });
});
