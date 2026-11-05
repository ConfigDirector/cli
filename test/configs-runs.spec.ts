import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import {
  configNotFound,
  projectPath,
  requestLinesOf,
  startBrowseAdminApi,
} from "./support/browse-admin-api.js";
import { productionEnvironment, targetingRulesOf } from "./support/evaluate-admin-api.js";
import { createSandbox } from "./support/sandbox.js";
import type { StubReply } from "./support/stub-admin-api.js";

const controlId = "0a000000-0000-4000-8000-000000000001";
const treatmentId = "0a000000-0000-4000-8000-000000000002";
const earlierVariationId = "0a000000-0000-4000-8000-000000000003";
const rolloutRuleId = "0b000000-0000-4000-8000-000000000001";

const experiment = {
  id: "config-experiment",
  projectId: "project",
  key: "checkout-cta-copy",
  role: "experiment",
  lifetime: "temporary",
  type: "string",
  state: "in-use",
  server: true,
  client: true,
  tags: [],
  deprecatedKeys: [],
  variations: [
    { id: controlId, name: "control", value: "Start free trial" },
    { id: treatmentId, name: "treatment-a", value: "Try it free for 14 days" },
  ],
  targets: [],
};

const noExposures = {
  rollouts: [],
  evaluationsWithoutIdentifier: 0,
  evaluationsFromSdksNotReportingExposures: 0,
};

const runningRun = {
  id: "run-running",
  configId: experiment.id,
  environmentId: productionEnvironment.id,
  startedAt: "2026-11-03T12:00:00.000Z",
  rollouts: [{ ruleId: rolloutRuleId, shares: [] }],
  exposures: {
    rollouts: [
      {
        ruleId: rolloutRuleId,
        exposures: 810,
        evaluations: 3201,
        verdict: "matches",
        variations: [
          { variationId: controlId, percentage: 50, exposures: 412 },
          { variationId: treatmentId, percentage: 50, exposures: 398 },
        ],
      },
    ],
    evaluationsWithoutIdentifier: 0,
    evaluationsFromSdksNotReportingExposures: 0,
  },
};

const endedRun = (fields: { outcome: string; shippedVariationId?: string }) => ({
  id: `run-${fields.outcome}`,
  configId: experiment.id,
  environmentId: productionEnvironment.id,
  startedAt: "2026-10-01T09:00:00.000Z",
  endedAt: "2026-10-15T09:30:00.000Z",
  rollouts: [],
  exposures: noExposures,
  ...fields,
});

const configPath = "/configs/checkout-cta-copy";
const runsPath = `/configs/checkout-cta-copy/environments/${productionEnvironment.id}/runs`;

const startRunsAdminApi = (runs: object[]) =>
  startBrowseAdminApi({
    [configPath]: { status: 200, body: experiment },
    [runsPath]: { status: 200, body: runs },
  });

const runCommand = async (baseUrl: string, commandLineArguments: string[]) => {
  const invocation = (await createSandbox()).invocation({
    commandLineArguments: [...commandLineArguments, "--project", "web-app", "--token", "cd_flag_token"],
    environmentVariables: { CONFIGDIRECTOR_BASE_URL: baseUrl },
  });

  const exitCode = await run(invocation);

  return { exitCode, stdout: invocation.stdout.text(), stderr: invocation.stderr.text() };
};

const listRuns = (baseUrl: string, ...extraArguments: string[]) =>
  runCommand(baseUrl, [
    "configs",
    "runs",
    "checkout-cta-copy",
    "--environment",
    "production",
    ...extraArguments,
  ]);

const rolloutLinesOf = async (rollout: object) => {
  const adminApi = await startRunsAdminApi([
    {
      ...runningRun,
      exposures: { ...runningRun.exposures, rollouts: [{ ...runningRun.exposures.rollouts[0], ...rollout }] },
    },
  ]);

  const { stdout } = await listRuns(adminApi.baseUrl);

  return stdout.split("\n");
};

const uncountedEvaluationLinesOf = async (uncountedEvaluations: object) => {
  const adminApi = await startRunsAdminApi([
    { ...runningRun, rollouts: [], exposures: { ...noExposures, ...uncountedEvaluations } },
  ]);

  const { stdout } = await listRuns(adminApi.baseUrl);

  return stdout.split("\n").slice(3);
};

describe("configs runs", () => {
  it("prints a run with its exposures per variation against the configured shares", async () => {
    const adminApi = await startRunsAdminApi([runningRun]);

    const { exitCode, stdout, stderr } = await listRuns(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Runs of checkout-cta-copy in production (live), newest first:",
      "",
      "Running since 2026-11-03 12:00 UTC",
      "  Rollout: everyone not caught by a rule above",
      "    control (Start free trial)              412 exposures   configured 50%",
      "    treatment-a (Try it free for 14 days)   398 exposures   configured 50%",
      "    810 contexts exposed, 3201 evaluations. The split matches the configured shares.",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/environments")}`,
      `GET ${projectPath(configPath)}`,
      `GET ${projectPath(runsPath)}`,
    ]);
  });

  it("names the conditions of a rollout that a conditional rule serves", async () => {
    const adminApi = await startRunsAdminApi([
      {
        ...runningRun,
        rollouts: [
          { ruleId: rolloutRuleId, conditions: "IF context's trait /plan is one of [pro, team]", shares: [] },
        ],
      },
    ]);

    const { stdout } = await listRuns(adminApi.baseUrl);

    expect(stdout.split("\n")[3]).toEqual("  Rollout: IF context's trait /plan is one of [pro, team]");
  });

  it("writes one exposure and one evaluation in the singular", async () => {
    const lines = await rolloutLinesOf({
      exposures: 1,
      evaluations: 1,
      verdict: "needs-more-exposures",
      variations: [{ variationId: controlId, percentage: 100, exposures: 1 }],
    });

    expect(lines.slice(4, 6)).toEqual([
      "    control (Start free trial)   1 exposure   configured 100%",
      "    1 context exposed, 1 evaluation. The run needs more exposures before the split can be checked against the configured shares.",
    ]);
  });

  it("says when the split does not match the configured shares", async () => {
    const lines = await rolloutLinesOf({ verdict: "mismatch" });

    expect(lines[6]).toEqual(
      "    810 contexts exposed, 3201 evaluations. The split does not match the configured shares. " +
        "This usually means some contexts evaluate without a stable identifier, or a rule above the split catches part of the traffic. Results from this run are not reliable.",
    );
  });

  it("prints a verdict the CLI does not know by its name", async () => {
    const lines = await rolloutLinesOf({ verdict: "too-early" });

    expect(lines[6]).toEqual("    810 contexts exposed, 3201 evaluations. too-early");
  });

  it("says a variation is no longer listed when its value was edited since the run started", async () => {
    const lines = await rolloutLinesOf({
      variations: [{ variationId: earlierVariationId, percentage: 50, exposures: 7 }],
    });

    expect(lines[4]).toEqual("    a variation no longer listed   7 exposures   configured 50%");
  });

  it("writes an unnamed variation as its value alone", async () => {
    const adminApi = await startBrowseAdminApi({
      [configPath]: {
        status: 200,
        body: { ...experiment, variations: [{ id: controlId, name: null, value: "Start free trial" }] },
      },
      [runsPath]: { status: 200, body: [runningRun] },
    });

    const { stdout } = await listRuns(adminApi.baseUrl);

    expect(stdout.split("\n")[4]).toEqual(
      "    Start free trial               412 exposures   configured 50%",
    );
  });

  it("names the variation a shipped run shipped and when the run started and ended", async () => {
    const adminApi = await startRunsAdminApi([
      endedRun({ outcome: "shipped", shippedVariationId: treatmentId }),
    ]);

    const { stdout } = await listRuns(adminApi.baseUrl);

    expect(stdout.split("\n")[2]).toEqual(
      "Shipped treatment-a (Try it free for 14 days), 2026-10-01 09:00 UTC to 2026-10-15 09:30 UTC",
    );
  });

  it("says a run was shipped alone when its variation is no longer listed", async () => {
    const adminApi = await startRunsAdminApi([
      endedRun({ outcome: "shipped", shippedVariationId: earlierVariationId }),
    ]);

    const { stdout } = await listRuns(adminApi.baseUrl);

    expect(stdout.split("\n")[2]).toEqual("Shipped, 2026-10-01 09:00 UTC to 2026-10-15 09:30 UTC");
  });

  it("says a run was stopped", async () => {
    const adminApi = await startRunsAdminApi([endedRun({ outcome: "stopped" })]);

    const { stdout } = await listRuns(adminApi.baseUrl);

    expect(stdout.split("\n")[2]).toEqual("Stopped, 2026-10-01 09:00 UTC to 2026-10-15 09:30 UTC");
  });

  it("says a run was replaced", async () => {
    const adminApi = await startRunsAdminApi([endedRun({ outcome: "replaced" })]);

    const { stdout } = await listRuns(adminApi.baseUrl);

    expect(stdout.split("\n")[2]).toEqual("Replaced, 2026-10-01 09:00 UTC to 2026-10-15 09:30 UTC");
  });

  it("prints an outcome the CLI does not know by its name", async () => {
    const adminApi = await startRunsAdminApi([endedRun({ outcome: "abandoned" })]);

    const { exitCode, stdout } = await listRuns(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stdout.split("\n")[2]).toEqual("abandoned, 2026-10-01 09:00 UTC to 2026-10-15 09:30 UTC");
  });

  it("separates the runs with a blank line, in the order the Admin API lists them", async () => {
    const adminApi = await startRunsAdminApi([
      endedRun({ outcome: "stopped" }),
      { ...endedRun({ outcome: "replaced" }), startedAt: "2026-09-01T09:00:00.000Z" },
    ]);

    const { stdout } = await listRuns(adminApi.baseUrl);

    expect(stdout.split("\n")).toEqual([
      "Runs of checkout-cta-copy in production (live), newest first:",
      "",
      "Stopped, 2026-10-01 09:00 UTC to 2026-10-15 09:30 UTC",
      "",
      "Replaced, 2026-09-01 09:00 UTC to 2026-10-15 09:30 UTC",
      "",
    ]);
  });

  it("says how many evaluations came from SDK versions that do not report exposures yet", async () => {
    const lines = await uncountedEvaluationLinesOf({ evaluationsFromSdksNotReportingExposures: 7 });

    expect(lines).toEqual([
      "  7 evaluations came from SDK versions that do not report exposures yet. They are not counted above; update those SDKs to count them.",
      "",
    ]);
  });

  it("writes one evaluation from an SDK version that does not report exposures yet in the singular", async () => {
    const lines = await uncountedEvaluationLinesOf({ evaluationsFromSdksNotReportingExposures: 1 });

    expect(lines).toEqual([
      "  1 evaluation came from an SDK version that does not report exposures yet. It is not counted above; update that SDK to count it.",
      "",
    ]);
  });

  it("says how many evaluations came from contexts without an identifier", async () => {
    const lines = await uncountedEvaluationLinesOf({ evaluationsWithoutIdentifier: 12 });

    expect(lines).toEqual([
      "  12 evaluations came from contexts without an identifier and were served the default targeting rule value. They skip the split and are not exposures.",
      "",
    ]);
  });

  it("writes one evaluation from a context without an identifier in the singular", async () => {
    const lines = await uncountedEvaluationLinesOf({ evaluationsWithoutIdentifier: 1 });

    expect(lines).toEqual([
      "  1 evaluation came from a context without an identifier and was served the default targeting rule value. It skips the split and is not an exposure.",
      "",
    ]);
  });

  it("says when the config has no runs in the environment", async () => {
    const adminApi = await startRunsAdminApi([]);

    const { exitCode, stdout } = await listRuns(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stdout).toEqual("No runs of checkout-cta-copy in production (live).\n");
  });

  it("says the key is an old key when the config was renamed", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/old-cta-copy": { status: 200, body: experiment },
      [`/configs/old-cta-copy/environments/${productionEnvironment.id}/runs`]: {
        status: 200,
        body: [],
      },
    });

    const { stdout } = await runCommand(adminApi.baseUrl, [
      "configs",
      "runs",
      "old-cta-copy",
      "--environment",
      "production",
    ]);

    expect(stdout.split("\n")).toEqual([
      "old-cta-copy is an old key of checkout-cta-copy.",
      "No runs of checkout-cta-copy in production (live).",
      "",
    ]);
  });

  it("prints the Admin API's response as received with --json", async () => {
    const adminApi = await startRunsAdminApi([{ ...runningRun, fieldTheCliDoesNotRead: "kept" }]);

    const { exitCode, stdout } = await listRuns(adminApi.baseUrl, "--json");

    expect(exitCode).toEqual(0);
    expect(JSON.parse(stdout)).toEqual([{ ...runningRun, fieldTheCliDoesNotRead: "kept" }]);
  });

  it("exits 2 saying no config has the key", async () => {
    const adminApi = await startBrowseAdminApi({ [configPath]: configNotFound("checkout-cta-copy") });

    const { exitCode, stdout, stderr } = await listRuns(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "checkout-cta-copy".\n');
  });

  it("exits 2 listing the project's environments when no environment has the slug", async () => {
    const adminApi = await startRunsAdminApi([]);

    const { exitCode, stdout, stderr } = await runCommand(adminApi.baseUrl, [
      "configs",
      "runs",
      "checkout-cta-copy",
      "--environment",
      "staging",
    ]);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      'Error: No environment in web-app has the slug "staging". Its environments are test, production.\n',
    );
  });

  it("exits 2 before any request when --environment is left out", async () => {
    const adminApi = await startRunsAdminApi([]);

    const { exitCode, stderr } = await runCommand(adminApi.baseUrl, ["configs", "runs", "checkout-cta-copy"]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("--environment");
    expect(requestLinesOf(adminApi)).toEqual([]);
  });
});

const proPlanRule = {
  id: "0c000000-0000-4000-8000-000000000001",
  type: "conditional",
  order: 0,
  target: "value",
  value: "Start free trial",
  variationId: controlId,
  conditions: [
    {
      id: "0c000000-0000-4000-8000-000000000002",
      kind: "attribute",
      attribute: "traits",
      trait: "/plan",
      operator: "is one of",
      targetType: "text",
      targetValues: ["pro"],
    },
  ],
};

const betaSegmentId = "0d000000-0000-4000-8000-000000000001";

const betaSegmentRule = {
  ...proPlanRule,
  conditions: [
    { id: "0c000000-0000-4000-8000-000000000003", kind: "segment", operator: "in", segmentId: betaSegmentId },
  ],
};

const experimentServing = (variationId: string, value: string, rules: object[] = []) => ({
  ...experiment,
  targets: [{ ...targetingRulesOf(rules), defaultValue: value, defaultVariationId: variationId }],
});

const shipPath = `/configs/checkout-cta-copy/environments/${productionEnvironment.id}/ship`;
const stopPath = `/configs/checkout-cta-copy/environments/${productionEnvironment.id}/stop`;

const rejectedRequest = (name: string, message: string): StubReply => ({
  status: 400,
  body: { errors: [{ name, message }] },
});

const startShipAdminApi = (shipReply: StubReply, config: object = experiment) =>
  startBrowseAdminApi({
    [configPath]: { status: 200, body: config },
    [shipPath]: shipReply,
  });

const shippedTreatment: StubReply = {
  status: 200,
  body: experimentServing(treatmentId, "Try it free for 14 days", [proPlanRule]),
};

const ship = (baseUrl: string, variation: string, ...extraArguments: string[]) =>
  runCommand(baseUrl, [
    "configs",
    "ship",
    "checkout-cta-copy",
    "--environment",
    "production",
    "--variation",
    variation,
    ...extraArguments,
  ]);

const shipBodies = (adminApi: Awaited<ReturnType<typeof startShipAdminApi>>) =>
  adminApi.receivedRequests
    .filter((request) => request.method === "POST" && request.path === projectPath(shipPath))
    .map((request) => request.body);

describe("configs ship", () => {
  it("ships the variation --variation names in a live environment, asking nothing, and prints the rules it saved", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment);

    const { exitCode, stdout, stderr } = await ship(adminApi.baseUrl, "treatment-a");

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Shipped treatment-a (Try it free for 14 days) in production (live).",
      "",
      "production (live)",
      "  1. plan is one of pro: control (Start free trial)",
      "  Default targeting rule: treatment-a (Try it free for 14 days)",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/environments")}`,
      `GET ${projectPath(configPath)}`,
      `POST ${projectPath(shipPath)}`,
    ]);
    expect(shipBodies(adminApi)).toEqual([{ variationId: treatmentId }]);
  });

  it("ships the variation --variation names by id", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment);

    const { exitCode } = await ship(adminApi.baseUrl, treatmentId);

    expect(exitCode).toEqual(0);
    expect(shipBodies(adminApi)).toEqual([{ variationId: treatmentId }]);
  });

  it("names a segment by its name in the rules it saved", async () => {
    const adminApi = await startBrowseAdminApi({
      [configPath]: { status: 200, body: experiment },
      [shipPath]: {
        status: 200,
        body: experimentServing(treatmentId, "Try it free for 14 days", [betaSegmentRule]),
      },
      "/segments": {
        status: 200,
        body: [{ id: betaSegmentId, key: "beta", name: "Beta testers", usages: [] }],
      },
    });

    const { stdout } = await ship(adminApi.baseUrl, "treatment-a");

    expect(stdout.split("\n")[3]).toEqual("  1. in segment Beta testers: control (Start free trial)");
  });

  it("says the key is an old key when the config was renamed", async () => {
    const adminApi = await startBrowseAdminApi({
      "/configs/old-cta-copy": { status: 200, body: experiment },
      [`/configs/old-cta-copy/environments/${productionEnvironment.id}/ship`]: shippedTreatment,
    });

    const { stdout } = await runCommand(adminApi.baseUrl, [
      "configs",
      "ship",
      "old-cta-copy",
      "--environment",
      "production",
      "--variation",
      "treatment-a",
    ]);

    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "old-cta-copy is an old key of checkout-cta-copy.",
      "Shipped treatment-a (Try it free for 14 days) in production (live).",
    ]);
  });

  it("prints the Admin API's response as received with --json", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment);

    const { exitCode, stdout } = await ship(adminApi.baseUrl, "treatment-a", "--json");

    expect(exitCode).toEqual(0);
    expect(JSON.parse(stdout)).toEqual(
      experimentServing(treatmentId, "Try it free for 14 days", [proPlanRule]),
    );
  });

  it("exits 2 listing the config's variations when --variation matches none, shipping nothing", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment);

    const { exitCode, stdout, stderr } = await ship(adminApi.baseUrl, "treatment-z");

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr.split("\n")).toEqual([
      'Error: checkout-cta-copy has no variation named or with the id "treatment-z". Its variations are:',
      `  control (Start free trial)              ${controlId}`,
      `  treatment-a (Try it free for 14 days)   ${treatmentId}`,
      "",
    ]);
    expect(shipBodies(adminApi)).toEqual([]);
  });

  it("exits 2 listing the matching variations' ids when several have the name, shipping nothing", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment, {
      ...experiment,
      variations: [
        { id: controlId, name: "copy", value: "Start free trial" },
        { id: treatmentId, name: "copy", value: "Try it free for 14 days" },
        { id: earlierVariationId, name: "other", value: "Get started" },
      ],
    });

    const { exitCode, stdout, stderr } = await ship(adminApi.baseUrl, "copy");

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr.split("\n")).toEqual([
      'Error: Several variations of checkout-cta-copy are named "copy". Give the id of the one to ship:',
      `  copy (Start free trial)          ${controlId}`,
      `  copy (Try it free for 14 days)   ${treatmentId}`,
      "",
    ]);
    expect(shipBodies(adminApi)).toEqual([]);
  });

  it("exits 2 saying a config without variations has nothing to ship, shipping nothing", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment, {
      ...experiment,
      role: "flag",
      variations: [],
    });

    const { exitCode, stdout, stderr } = await ship(adminApi.baseUrl, "treatment-a");

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: checkout-cta-copy has no variations to ship. Only an experiment has variations.\n",
    );
    expect(shipBodies(adminApi)).toEqual([]);
  });

  it("exits 2 with the reasons when ConfigDirector rejects the ship", async () => {
    const adminApi = await startShipAdminApi(
      rejectedRequest("variationId", "The variationId is not one of the config's variations"),
    );

    const { exitCode, stdout, stderr } = await ship(adminApi.baseUrl, "treatment-a");

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n  variationId: The variationId is not one of the config's variations\n",
    );
  });

  it("exits 2 saying no config has the key", async () => {
    const adminApi = await startBrowseAdminApi({ [configPath]: configNotFound("checkout-cta-copy") });

    const { exitCode, stdout, stderr } = await ship(adminApi.baseUrl, "treatment-a");

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "checkout-cta-copy".\n');
  });

  it("exits 2 saying no config has the key when the config is gone by the time of the ship", async () => {
    const adminApi = await startShipAdminApi(configNotFound("checkout-cta-copy"));

    const { exitCode, stderr } = await ship(adminApi.baseUrl, "treatment-a");

    expect(exitCode).toEqual(2);
    expect(stderr).toEqual('Error: No config in web-app has the key "checkout-cta-copy".\n');
  });

  it("exits 2 before any request when --variation is left out", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment);

    const { exitCode, stderr } = await runCommand(adminApi.baseUrl, [
      "configs",
      "ship",
      "checkout-cta-copy",
      "--environment",
      "production",
    ]);

    expect(exitCode).toEqual(2);
    expect(stderr).toContain("--variation");
    expect(requestLinesOf(adminApi)).toEqual([]);
  });
});

const stop = (baseUrl: string, ...extraArguments: string[]) =>
  runCommand(baseUrl, [
    "configs",
    "stop",
    "checkout-cta-copy",
    "--environment",
    "production",
    ...extraArguments,
  ]);

const stoppedRun: StubReply = {
  status: 200,
  body: experimentServing(controlId, "Start free trial", [proPlanRule]),
};

describe("configs stop", () => {
  it("stops the run in a live environment, asking nothing, and prints the rules it saved", async () => {
    const adminApi = await startBrowseAdminApi({ [stopPath]: stoppedRun });

    const { exitCode, stdout, stderr } = await stop(adminApi.baseUrl);

    expect(exitCode).toEqual(0);
    expect(stderr).toEqual("");
    expect(stdout.split("\n")).toEqual([
      "Stopped the run of checkout-cta-copy in production (live).",
      "",
      "production (live)",
      "  1. plan is one of pro: control (Start free trial)",
      "  Default targeting rule: control (Start free trial)",
      "",
    ]);
    expect(requestLinesOf(adminApi)).toEqual([
      "GET /v1/projects",
      `GET ${projectPath("/environments")}`,
      `POST ${projectPath(stopPath)}`,
    ]);
  });

  it("says the key is an old key when the config was renamed", async () => {
    const adminApi = await startBrowseAdminApi({
      [`/configs/old-cta-copy/environments/${productionEnvironment.id}/stop`]: stoppedRun,
    });

    const { stdout } = await runCommand(adminApi.baseUrl, [
      "configs",
      "stop",
      "old-cta-copy",
      "--environment",
      "production",
    ]);

    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "old-cta-copy is an old key of checkout-cta-copy.",
      "Stopped the run of checkout-cta-copy in production (live).",
    ]);
  });

  it("prints the Admin API's response as received with --json", async () => {
    const adminApi = await startBrowseAdminApi({ [stopPath]: stoppedRun });

    const { exitCode, stdout } = await stop(adminApi.baseUrl, "--json");

    expect(exitCode).toEqual(0);
    expect(JSON.parse(stdout)).toEqual(experimentServing(controlId, "Start free trial", [proPlanRule]));
  });

  it("exits 2 with the reason when the environment holds no rollout", async () => {
    const adminApi = await startBrowseAdminApi({
      [stopPath]: rejectedRequest(
        "environmentId",
        "No percentage rollout is saved in the environment, so there is no run to stop",
      ),
    });

    const { exitCode, stdout, stderr } = await stop(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual(
      "Error: The Admin API rejected the request:\n  environmentId: No percentage rollout is saved in the environment, so there is no run to stop\n",
    );
  });

  it("exits 2 saying no config has the key", async () => {
    const adminApi = await startBrowseAdminApi({ [stopPath]: configNotFound("checkout-cta-copy") });

    const { exitCode, stdout, stderr } = await stop(adminApi.baseUrl);

    expect(exitCode).toEqual(2);
    expect(stdout).toEqual("");
    expect(stderr).toEqual('Error: No config in web-app has the key "checkout-cta-copy".\n');
  });

  it("exits 2 listing the project's environments when no environment has the slug", async () => {
    const adminApi = await startBrowseAdminApi({ [stopPath]: stoppedRun });

    const { exitCode, stderr } = await runCommand(adminApi.baseUrl, [
      "configs",
      "stop",
      "checkout-cta-copy",
      "--environment",
      "staging",
    ]);

    expect(exitCode).toEqual(2);
    expect(stderr).toEqual(
      'Error: No environment in web-app has the slug "staging". Its environments are test, production.\n',
    );
  });
});
