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

const noResults = { rollouts: [], primary: [], secondary: [], guardrail: [] };

const noTrackedEvents = { events: [] };

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
  trackedEvents: noTrackedEvents,
  results: noResults,
};

const endedRun = (fields: { outcome: string; shippedVariationId?: string }) => ({
  id: `run-${fields.outcome}`,
  configId: experiment.id,
  environmentId: productionEnvironment.id,
  startedAt: "2026-10-01T09:00:00.000Z",
  endedAt: "2026-10-15T09:30:00.000Z",
  rollouts: [],
  exposures: noExposures,
  trackedEvents: noTrackedEvents,
  results: noResults,
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

  it("says how many evaluations came from anonymous contexts", async () => {
    const lines = await uncountedEvaluationLinesOf({ evaluationsWithoutIdentifier: 12 });

    expect(lines).toEqual([
      "  12 evaluations came from anonymous contexts, so they are not exposures. In a server SDK, a context without an identifier skips the split and is served the default targeting rule value; any other anonymous context sees its share of the split without being stored.",
      "",
    ]);
  });

  it("writes one evaluation from an anonymous context in the singular", async () => {
    const lines = await uncountedEvaluationLinesOf({ evaluationsWithoutIdentifier: 1 });

    expect(lines).toEqual([
      "  1 evaluation came from an anonymous context, so it is not an exposure. In a server SDK, a context without an identifier skips the split and is served the default targeting rule value; any other anonymous context sees its share of the split without being stored.",
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

const thirdId = "0a000000-0000-4000-8000-000000000004";

const conversionResultOf = (variations: object[], rolloutFields: object = {}) => ({
  metricId: "0c000000-0000-4000-8000-000000000001",
  eventName: "checkout_completed",
  filter: null,
  valueField: null,
  counting: { kind: "whole-run" },
  direction: "higher-is-better",
  primaryKind: "conversion",
  kinds: [{ kind: "conversion", rollouts: [{ ruleId: rolloutRuleId, variations, ...rolloutFields }] }],
});

const controlConversion = { variationId: controlId, exposures: 412, converters: 12, value: 0.0291 };

const treatmentConversion = {
  variationId: treatmentId,
  exposures: 398,
  converters: 18,
  value: 0.0452,
  lift: 0.553,
  interval: { low: 0.12, high: 0.98 },
  chanceToBeatControl: 0.996,
  verdict: "likely-better",
};

const supportTicketsGuardrail = {
  metricId: "0c000000-0000-4000-8000-000000000002",
  eventName: "support_ticket_opened",
  filter: null,
  valueField: null,
  counting: { kind: "whole-run" },
  direction: "lower-is-better",
  primaryKind: null,
  kinds: [
    {
      kind: "count-per-context",
      rollouts: [
        {
          ruleId: rolloutRuleId,
          variations: [
            { variationId: controlId, exposures: 412, value: 0.12 },
            {
              variationId: treatmentId,
              exposures: 398,
              value: 0.13,
              lift: 0.0833,
              interval: { low: -0.1, high: 0.29 },
              chanceToBeatControl: 0.22,
              verdict: "no-clear-difference",
            },
          ],
        },
      ],
    },
  ],
};

const readyRollout = { ruleId: rolloutRuleId, controlVariationId: controlId, state: "ready", crossovers: 0 };

const runWithResults = (results: object, fields: object = {}) => ({
  ...runningRun,
  results: { rollouts: [readyRollout], primary: [], secondary: [], guardrail: [], ...results },
  ...fields,
});

const runLinesOf = async (runs: object[], configBody: object = experiment) => {
  const adminApi = await startBrowseAdminApi({
    [configPath]: { status: 200, body: configBody },
    [runsPath]: { status: 200, body: runs },
  });

  const { stdout } = await listRuns(adminApi.baseUrl);

  return stdout.split("\n");
};

describe("configs runs results", () => {
  it("prints each metric kind's results under its rollout: every variation's value against the control, with the lift and its likely range, the chance to beat control and the verdict", async () => {
    const lines = await runLinesOf([
      runWithResults({
        primary: [conversionResultOf([controlConversion, treatmentConversion])],
        guardrail: [supportTicketsGuardrail],
      }),
    ]);

    expect(lines).toEqual([
      "Runs of checkout-cta-copy in production (live), newest first:",
      "",
      "Running since 2026-11-03 12:00 UTC",
      "  Rollout: everyone not caught by a rule above",
      "    control (Start free trial)              412 exposures   configured 50%",
      "    treatment-a (Try it free for 14 days)   398 exposures   configured 50%",
      "    810 contexts exposed, 3201 evaluations. The split matches the configured shares.",
      "    Primary metric: checkout_completed, conversion, higher is better",
      "      control (Start free trial)              2.9%   control",
      "      treatment-a (Try it free for 14 days)   4.5%   +55% (+12% to +98%)   >99% chance to beat control   likely better",
      "    Guardrail: support_ticket_opened, count per context, lower is better",
      "      control (Start free trial)              0.12   control",
      "      treatment-a (Try it free for 14 days)   0.13   +8% (-10% to +29%)   22% chance to beat control   no clear difference",
      "  Results can be up to 25 minutes behind.",
      "",
    ]);
  });

  it("names a metric with a filter and a value field by its event name, its filter and its value field in its results heading", async () => {
    const lines = await runLinesOf([
      runWithResults({
        secondary: [
          {
            ...conversionResultOf([controlConversion, treatmentConversion]),
            filter: [{ field: "/plan", targetType: "text", operator: "is one of", targetValues: ["team"] }],
            valueField: "/items",
            primaryKind: null,
          },
        ],
      }),
    ]);

    expect(lines[7]).toEqual(
      "    Secondary metric: checkout_completed · /plan is one of [team] · value from /items, conversion, higher is better",
    );
  });

  it("says under each kind heading since when the run counted a metric attached while it was running", async () => {
    const teamCheckouts = {
      ...conversionResultOf([controlConversion, treatmentConversion]),
      filter: [{ field: "/plan", targetType: "text", operator: "is one of", targetValues: ["team"] }],
      counting: { kind: "since", since: "2026-11-05T09:30:00.000Z" },
      primaryKind: null,
    };
    const lines = await runLinesOf([
      runWithResults({
        secondary: [
          {
            ...teamCheckouts,
            kinds: [...teamCheckouts.kinds, { ...teamCheckouts.kinds[0], kind: "count-per-context" }],
          },
        ],
      }),
    ]);

    expect(lines.slice(7, 15)).toEqual([
      "    Secondary metric: checkout_completed · /plan is one of [team], conversion, higher is better",
      "      Counted since 2026-11-05 09:30 UTC, when this metric was attached to the experiment. Events reported before then are not in these numbers.",
      "      control (Start free trial)              2.9%   control",
      "      treatment-a (Try it free for 14 days)   4.5%   +55% (+12% to +98%)   >99% chance to beat control   likely better",
      "    Secondary metric: checkout_completed · /plan is one of [team], count per context, higher is better",
      "      Counted since 2026-11-05 09:30 UTC, when this metric was attached to the experiment. Events reported before then are not in these numbers.",
      "      control (Start free trial)              0.03   control",
      "      treatment-a (Try it free for 14 days)   0.05   +55% (+12% to +98%)   >99% chance to beat control   likely better",
    ]);
  });

  it("prints a metric the run did not count with its heading and a line saying so, and no numbers", async () => {
    const lines = await runLinesOf([
      runWithResults({
        primary: [conversionResultOf([controlConversion, treatmentConversion])],
        guardrail: [
          {
            ...supportTicketsGuardrail,
            eventName: "checkout_completed",
            valueField: "/refunded",
            counting: { kind: "not-counted" },
            kinds: [],
          },
        ],
      }),
    ]);

    expect(lines.slice(7, 13)).toEqual([
      "    Primary metric: checkout_completed, conversion, higher is better",
      "      control (Start free trial)              2.9%   control",
      "      treatment-a (Try it free for 14 days)   4.5%   +55% (+12% to +98%)   >99% chance to beat control   likely better",
      "    Guardrail: checkout_completed · value from /refunded, lower is better",
      "      This run did not count this metric: a metric with a filter or a value field is counted from the moment it is attached to an experiment, and this one was not attached while the run was open.",
      "  Results can be up to 25 minutes behind.",
    ]);
  });

  it("names a secondary metric as one", async () => {
    const lines = await runLinesOf([
      runWithResults({
        secondary: [{ ...conversionResultOf([controlConversion, treatmentConversion]), primaryKind: null }],
      }),
    ]);

    expect(lines[7]).toEqual("    Secondary metric: checkout_completed, conversion, higher is better");
  });

  it("prints a line for each kind a metric reports", async () => {
    const lines = await runLinesOf([
      runWithResults({
        primary: [
          {
            ...conversionResultOf([controlConversion, treatmentConversion]),
            kinds: [
              ...conversionResultOf([controlConversion, treatmentConversion]).kinds,
              {
                kind: "value-per-context",
                rollouts: [
                  {
                    ruleId: rolloutRuleId,
                    variations: [
                      { variationId: controlId, exposures: 412, value: 1234.5 },
                      {
                        variationId: treatmentId,
                        exposures: 398,
                        value: 1301.25,
                        lift: 0.054,
                        interval: { low: -0.021, high: 0.13 },
                        chanceToBeatControl: 0.91,
                        verdict: "no-clear-difference",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);

    expect(lines.slice(10, 13)).toEqual([
      "    Primary metric: checkout_completed, value per context, higher is better",
      "      control (Start free trial)              1,234.50   control",
      "      treatment-a (Try it free for 14 days)   1,301.25   +5% (-2% to +13%)   91% chance to beat control   no clear difference",
    ]);
  });

  it("says the run needs more exposures and prints the values alone while the rollout does", async () => {
    const lines = await runLinesOf([
      runWithResults({
        rollouts: [{ ...readyRollout, state: "needs-more-exposures" }],
        primary: [
          conversionResultOf([
            controlConversion,
            { variationId: treatmentId, exposures: 98, converters: 4, value: 0.0408 },
          ]),
        ],
      }),
    ]);

    expect(lines.slice(7, 11)).toEqual([
      "    The run needs more exposures before the variations can be compared.",
      "    Primary metric: checkout_completed, conversion, higher is better",
      "      control (Start free trial)              2.9%   control",
      "      treatment-a (Try it free for 14 days)   4.1%",
    ]);
  });

  it("says how many contexts were exposed to more than one variation and left out of every metric", async () => {
    const lines = await runLinesOf([
      runWithResults({
        rollouts: [{ ...readyRollout, crossovers: 3 }],
        primary: [conversionResultOf([controlConversion, treatmentConversion])],
      }),
    ]);

    expect(lines[7]).toEqual(
      "    3 contexts were exposed to more than one variation and are left out of every metric.",
    );
  });

  it("writes one context exposed to more than one variation in the singular", async () => {
    const lines = await runLinesOf([
      runWithResults({
        rollouts: [{ ...readyRollout, crossovers: 1 }],
        primary: [conversionResultOf([controlConversion, treatmentConversion])],
      }),
    ]);

    expect(lines[7]).toEqual(
      "    1 context was exposed to more than one variation and is left out of every metric.",
    );
  });

  it("adds each variation's chance to be best, the control's included, with three or more variations", async () => {
    const threeVariationExperiment = {
      ...experiment,
      variations: [...experiment.variations, { id: thirdId, name: "treatment-b", value: "Start your trial" }],
    };
    const lines = await runLinesOf(
      [
        runWithResults({
          primary: [
            conversionResultOf([
              { ...controlConversion, chanceToBeBest: 0.01 },
              { ...treatmentConversion, chanceToBeBest: 0.82 },
              {
                variationId: thirdId,
                exposures: 401,
                converters: 13,
                value: 0.0324,
                lift: 0.113,
                interval: { low: -0.4, high: 1.1 },
                chanceToBeatControl: 0.62,
                chanceToBeBest: 0.17,
                verdict: "no-clear-difference",
              },
            ]),
          ],
        }),
      ],
      threeVariationExperiment,
    );

    expect(lines.slice(8, 11)).toEqual([
      "      control (Start free trial)              2.9%   control                                              1% chance to be best",
      "      treatment-a (Try it free for 14 days)   4.5%   +55% (+12% to +98%)    >99% chance to beat control   82% chance to be best   likely better",
      "      treatment-b (Start your trial)          3.2%   +11% (-40% to +110%)   62% chance to beat control    17% chance to be best   no clear difference",
    ]);
  });

  it("writes a dash for a lift there is no control value to take, and the lift alone when its range cannot be told", async () => {
    const lines = await runLinesOf([
      runWithResults({
        primary: [
          {
            ...supportTicketsGuardrail,
            primaryKind: "count-per-context",
            kinds: [
              {
                kind: "count-per-context",
                rollouts: [
                  {
                    ruleId: rolloutRuleId,
                    variations: [
                      { variationId: controlId, exposures: 412, value: 0 },
                      {
                        variationId: treatmentId,
                        exposures: 398,
                        value: 0.02,
                        chanceToBeatControl: 0.31,
                        verdict: "no-clear-difference",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        guardrail: [
          {
            ...supportTicketsGuardrail,
            eventName: "refund_requested",
            kinds: [
              {
                kind: "count-per-context",
                rollouts: [
                  {
                    ruleId: rolloutRuleId,
                    variations: [
                      { variationId: controlId, exposures: 412, value: 0.01 },
                      {
                        variationId: treatmentId,
                        exposures: 398,
                        value: 0.012,
                        lift: 0.2,
                        chanceToBeatControl: 0.4,
                        verdict: "no-clear-difference",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);

    expect([lines[9], lines[12]]).toEqual([
      "      treatment-a (Try it free for 14 days)   0.02   -         31% chance to beat control   no clear difference",
      "      treatment-a (Try it free for 14 days)   0.01   +20%      40% chance to beat control   no clear difference",
    ]);
  });

  it("writes a lift or a range bound that rounds to zero as 0%, with no sign", async () => {
    const lines = await runLinesOf([
      runWithResults({
        primary: [
          conversionResultOf([
            controlConversion,
            { ...treatmentConversion, lift: -0.004, interval: { low: -0.003, high: 0.06 } },
          ]),
        ],
      }),
    ]);

    expect(lines[9]).toEqual(
      "      treatment-a (Try it free for 14 days)   4.5%   0% (0% to +6%)   >99% chance to beat control   likely better",
    );
  });

  it("writes a verdict and a kind the CLI does not know by their names", async () => {
    const lines = await runLinesOf([
      runWithResults({
        primary: [
          {
            ...conversionResultOf([
              controlConversion,
              { ...treatmentConversion, verdict: "likely-equivalent" },
            ]),
            kinds: [
              {
                kind: "ratio",
                rollouts: [
                  {
                    ruleId: rolloutRuleId,
                    variations: [controlConversion, { ...treatmentConversion, verdict: "likely-equivalent" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);

    expect(lines.slice(7, 10)).toEqual([
      "    Primary metric: checkout_completed, ratio, higher is better",
      "      control (Start free trial)              0.03   control",
      "      treatment-a (Try it free for 14 days)   0.05   +55% (+12% to +98%)   >99% chance to beat control   likely-equivalent",
    ]);
  });

  it("says when an ended run's final results were taken", async () => {
    const lines = await runLinesOf([
      {
        ...endedRun({ outcome: "stopped" }),
        rollouts: runningRun.rollouts,
        exposures: runningRun.exposures,
        results: {
          asOf: "2026-10-15T09:30:00.000Z",
          rollouts: [readyRollout],
          primary: [conversionResultOf([controlConversion, treatmentConversion])],
          secondary: [],
          guardrail: [],
        },
      },
    ]);

    expect(lines.at(-2)).toEqual("  Final results, as of 2026-10-15 09:30 UTC, when the run ended.");
  });

  it("says nothing about how fresh the results are for an ended run without its final results yet", async () => {
    const lines = await runLinesOf([
      {
        ...endedRun({ outcome: "stopped" }),
        rollouts: runningRun.rollouts,
        exposures: runningRun.exposures,
        results: {
          rollouts: [readyRollout],
          primary: [conversionResultOf([controlConversion, treatmentConversion])],
          secondary: [],
          guardrail: [],
        },
      },
    ]);

    expect(lines.at(-2)).toEqual(
      "      treatment-a (Try it free for 14 days)   4.5%   +55% (+12% to +98%)   >99% chance to beat control   likely better",
    );
  });

  it("prints the run's hypothesis and the note it ended with", async () => {
    const lines = await runLinesOf([
      {
        ...endedRun({ outcome: "stopped" }),
        hypothesis: "Urgency copy raises checkout completion by 5%",
        note: "Support tickets rose with the new copy",
      },
    ]);

    expect(lines.slice(2, 5)).toEqual([
      "Stopped, 2026-10-01 09:00 UTC to 2026-10-15 09:30 UTC",
      "  Hypothesis: Urgency copy raises checkout completion by 5%",
      "  Ended with note: Support tickets rose with the new copy",
    ]);
  });

  it("lists the events reported during the run that no metric measures, with how many contexts reported each", async () => {
    const lines = await runLinesOf([
      runWithResults(
        { primary: [conversionResultOf([controlConversion, treatmentConversion])] },
        {
          trackedEvents: {
            events: [
              { name: "add_to_cart", contexts: 340, variations: [] },
              { name: "checkout_completed", contexts: 30, variations: [] },
              { name: "search_used", contexts: 1, variations: [] },
            ],
          },
        },
      ),
    ]);

    expect(lines.slice(-3)).toEqual([
      "  Events with no metric: add_to_cart (340 contexts), search_used (1 context)",
      "  Results can be up to 25 minutes behind.",
      "",
    ]);
  });

  it("lists every event reported during the run when the experiment has no metric, and says nothing about results", async () => {
    const lines = await runLinesOf([
      {
        ...runningRun,
        trackedEvents: { events: [{ name: "checkout_completed", contexts: 30, variations: [] }] },
      },
    ]);

    expect(lines.slice(-2)).toEqual(["  Events with no metric: checkout_completed (30 contexts)", ""]);
  });
});

const treatmentConversionWithoutClearDifference = {
  variationId: treatmentId,
  exposures: 398,
  converters: 14,
  value: 0.0352,
  lift: 0.19,
  interval: { low: -0.43, high: 1.54 },
  chanceToBeatControl: 0.69,
  verdict: "no-clear-difference",
};

const runLengthEstimate = {
  analyzedExposures: 810,
  exposuresPerDay: 98.4,
  paceMeasuredSince: "2026-11-04T00:00:00.000Z",
  lifts: [
    { lift: 0.02, exposuresNeeded: 2082762, daysRemaining: 21159 },
    { lift: 0.05, exposuresNeeded: 338034, daysRemaining: 3428 },
    { lift: 0.1, exposuresNeeded: 86501, daysRemaining: 871 },
    { lift: 0.2, exposuresNeeded: 22617, daysRemaining: 222 },
    { lift: 0.5, exposuresNeeded: 4089, daysRemaining: 34 },
  ],
};

const estimateLinesOf = async (estimate: object) =>
  runLinesOf([
    runWithResults({
      primary: [
        conversionResultOf([controlConversion, treatmentConversionWithoutClearDifference], {
          runLengthEstimate: estimate,
        }),
      ],
    }),
  ]);

describe("configs runs run length estimate", () => {
  it("prints, under the kind that carries the estimate, each lift's exposures so far against those needed and the days remaining at the pace since it was measured", async () => {
    const lines = await runLinesOf([
      runWithResults({
        primary: [
          conversionResultOf([controlConversion, treatmentConversionWithoutClearDifference], {
            runLengthEstimate,
          }),
        ],
        guardrail: [supportTicketsGuardrail],
      }),
    ]);

    expect(lines).toEqual([
      "Runs of checkout-cta-copy in production (live), newest first:",
      "",
      "Running since 2026-11-03 12:00 UTC",
      "  Rollout: everyone not caught by a rule above",
      "    control (Start free trial)              412 exposures   configured 50%",
      "    treatment-a (Try it free for 14 days)   398 exposures   configured 50%",
      "    810 contexts exposed, 3201 evaluations. The split matches the configured shares.",
      "    Primary metric: checkout_completed, conversion, higher is better",
      "      control (Start free trial)              2.9%   control",
      "      treatment-a (Try it free for 14 days)   3.5%   +19% (-43% to +154%)   69% chance to beat control   no clear difference",
      "    How long to run, at the pace since 2026-11-04 00:00 UTC: about 98 new exposures a day",
      "      For a real lift of +2%    810 of about 2,082,762 exposures   more than a year remaining",
      "      For a real lift of +5%    810 of about 338,034 exposures     more than a year remaining",
      "      For a real lift of +10%   810 of about 86,501 exposures      more than a year remaining",
      "      For a real lift of +20%   810 of about 22,617 exposures      about 222 days remaining",
      "      For a real lift of +50%   810 of about 4,089 exposures       about 34 days remaining",
      "    A row's lift is one a variation might really have over the control, not the lift measured so far: the smaller it is, the longer the run.",
      "    Whatever the estimate says, a run should cover at least one full week, so every day of the week is in the result.",
      "    Guardrail: support_ticket_opened, count per context, lower is better",
      "      control (Start free trial)              0.12   control",
      "      treatment-a (Try it free for 14 days)   0.13   +8% (-10% to +29%)   22% chance to beat control   no clear difference",
      "  Results can be up to 25 minutes behind.",
      "",
    ]);
  });

  it("says a lift has enough exposures once the rollout has as many as it needs", async () => {
    const lines = await estimateLinesOf({
      ...runLengthEstimate,
      analyzedExposures: 4240,
      lifts: [{ lift: 0.5, exposuresNeeded: 4089, daysRemaining: 0 }],
    });

    expect(lines[11]).toEqual(
      "      For a real lift of +50%   4,240 of about 4,089 exposures   enough exposures",
    );
  });

  it("writes more than 365 days remaining as more than a year", async () => {
    const lines = await estimateLinesOf({
      ...runLengthEstimate,
      lifts: [{ lift: 0.1, exposuresNeeded: 36818, daysRemaining: 366 }],
    });

    expect(lines[11]).toEqual(
      "      For a real lift of +10%   810 of about 36,818 exposures   more than a year remaining",
    );
  });

  it("writes 365 days remaining in days", async () => {
    const lines = await estimateLinesOf({
      ...runLengthEstimate,
      lifts: [{ lift: 0.1, exposuresNeeded: 36727, daysRemaining: 365 }],
    });

    expect(lines[11]).toEqual(
      "      For a real lift of +10%   810 of about 36,727 exposures   about 365 days remaining",
    );
  });

  it("says no new contexts were exposed since the pace was measured, and gives the exposures alone for a lift without days remaining", async () => {
    const lines = await estimateLinesOf({
      ...runLengthEstimate,
      exposuresPerDay: 0,
      lifts: [
        { lift: 0.2, exposuresNeeded: 22617 },
        { lift: 0.5, exposuresNeeded: 4089 },
      ],
    });

    expect(lines.slice(10, 13)).toEqual([
      "    How long to run: no new contexts were exposed since 2026-11-04 00:00 UTC, so the days cannot be estimated.",
      "      For a real lift of +20%   810 of about 22,617 exposures",
      "      For a real lift of +50%   810 of about 4,089 exposures",
    ]);
  });

  it("writes one day remaining in the singular", async () => {
    const lines = await estimateLinesOf({
      ...runLengthEstimate,
      lifts: [{ lift: 0.5, exposuresNeeded: 4089, daysRemaining: 1 }],
    });

    expect(lines[11]).toEqual(
      "      For a real lift of +50%   810 of about 4,089 exposures   about 1 day remaining",
    );
  });

  it("writes a pace of one new exposure a day in the singular", async () => {
    const lines = await estimateLinesOf({ ...runLengthEstimate, exposuresPerDay: 1.2 });

    expect(lines[10]).toEqual(
      "    How long to run, at the pace since 2026-11-04 00:00 UTC: about 1 new exposure a day",
    );
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

  it("sends --note with the ship, for the ended run to keep", async () => {
    const adminApi = await startShipAdminApi(shippedTreatment);

    const { exitCode } = await ship(
      adminApi.baseUrl,
      "treatment-a",
      "--note",
      "Checkout completion rose 14%",
    );

    expect(exitCode).toEqual(0);
    expect(shipBodies(adminApi)).toEqual([
      { variationId: treatmentId, note: "Checkout completion rose 14%" },
    ]);
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

const stopBodies = (adminApi: Awaited<ReturnType<typeof startBrowseAdminApi>>) =>
  adminApi.receivedRequests
    .filter((request) => request.method === "POST" && request.path === projectPath(stopPath))
    .map((request) => request.body);

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

  it("sends an empty stop without --note", async () => {
    const adminApi = await startBrowseAdminApi({ [stopPath]: stoppedRun });

    await stop(adminApi.baseUrl);

    expect(stopBodies(adminApi)).toEqual([{}]);
  });

  it("sends --note with the stop, for the ended run to keep", async () => {
    const adminApi = await startBrowseAdminApi({ [stopPath]: stoppedRun });

    const { exitCode } = await stop(adminApi.baseUrl, "--note", "Support tickets rose with the new copy");

    expect(exitCode).toEqual(0);
    expect(stopBodies(adminApi)).toEqual([{ note: "Support tickets rose with the new copy" }]);
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
