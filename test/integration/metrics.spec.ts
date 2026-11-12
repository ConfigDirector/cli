import { describe, expect, it } from "vitest";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest, uniqueKey } from "./support/built-cli.js";
import { createConversionMetric, createTeamPlanItemsMetric, teamPlanFilter } from "./support/fixtures.js";

type ListedMetric = { id: string; eventName: string; kinds: string[]; direction: string; usages: unknown[] };

const listedMetric = (metrics: unknown, eventName: string) =>
  (metrics as ListedMetric[]).find((metric) => metric.eventName === eventName);

const listedMetricIds = (metrics: unknown) => (metrics as ListedMetric[]).map((metric) => metric.id);

describe.skipIf(adminApiUnderTest() === undefined)("metrics against the Admin API", () => {
  it("creates a metric that the project then lists as used by no experiment", async () => {
    const cli = await startCliUnderTest();

    const metric = await createConversionMetric(cli);

    const metrics = jsonOf(await cli.run(["metrics", "list", "--json"]));
    expect(listedMetric(metrics, metric.eventName)).toEqual(
      expect.objectContaining({
        id: metric.id,
        kinds: ["conversion"],
        direction: "higher-is-better",
        usages: [],
      }),
    );
  });

  it("shows a metric by its event name", async () => {
    const cli = await startCliUnderTest();
    const metric = await createConversionMetric(cli);

    const result = await cli.run(["metrics", "get", metric.eventName]);

    expect(result.exitCode).toEqual(0);
    expect(result.stdout.split("\n")).toEqual([
      metric.eventName,
      "  Kinds: conversion",
      "  Direction: higher is better",
      "",
      "No experiment uses it.",
      "",
    ]);
  });

  it("exits 2 saying no metric has the event name when metrics get names a missing metric", async () => {
    const cli = await startCliUnderTest();
    const eventName = uniqueKey();

    const result = await cli.run(["metrics", "get", eventName]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(
      `Error: No metric in ${cli.project.slug} has the event name "${eventName}".\n`,
    );
  });

  it("changes a metric's kinds and direction, keeping its description", async () => {
    const cli = await startCliUnderTest();
    const metric = await createConversionMetric(cli);
    await cli.run(["metrics", "update", metric.eventName, "--description", "Orders paid for."]);

    const result = await cli.run([
      "metrics",
      "update",
      metric.eventName,
      "--kind",
      "conversion",
      "--kind",
      "value-per-context",
      "--direction",
      "lower-is-better",
    ]);

    expect(result.exitCode).toEqual(0);
    expect(jsonOf(await cli.run(["metrics", "get", metric.eventName, "--json"]))).toEqual(
      expect.objectContaining({
        description: "Orders paid for.",
        kinds: ["conversion", "value-per-context"],
        direction: "lower-is-better",
      }),
    );
  });

  it("exits 2 saying no metric has the event name when metrics update names a missing metric", async () => {
    const cli = await startCliUnderTest();
    const eventName = uniqueKey();

    const result = await cli.run(["metrics", "update", eventName, "--direction", "lower-is-better"]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(
      `Error: No metric in ${cli.project.slug} has the event name "${eventName}".\n`,
    );
  });

  it("exits 2 saying no metric has the event name when metrics delete names a missing metric", async () => {
    const cli = await startCliUnderTest();
    const eventName = uniqueKey();

    const result = await cli.run(["metrics", "delete", eventName]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(
      `Error: No metric in ${cli.project.slug} has the event name "${eventName}".\n`,
    );
  });

  it("deletes a metric so the project no longer lists it", async () => {
    const cli = await startCliUnderTest();
    const metric = await createConversionMetric(cli);

    const result = await cli.run(["metrics", "delete", metric.eventName, "--json"]);

    expect(result.exitCode).toEqual(0);
    expect(jsonOf(result)).toEqual({ deletedMetricId: metric.id, deletedEventName: metric.eventName });
    expect(
      listedMetric(jsonOf(await cli.run(["metrics", "list", "--json"])), metric.eventName),
    ).toBeUndefined();
  });

  it("creates a metric with a filter and a value field, which the project then lists with both", async () => {
    const cli = await startCliUnderTest();

    const metric = await createTeamPlanItemsMetric(cli, uniqueKey());

    expect(listedMetric(jsonOf(await cli.run(["metrics", "list", "--json"])), metric.eventName)).toEqual(
      expect.objectContaining({
        id: metric.id,
        filter: teamPlanFilter,
        valueField: "/items",
        kinds: ["value-per-context"],
      }),
    );
  });

  it("exits 2 with ConfigDirector's refusal when metrics create has a value field without value per context", async () => {
    const cli = await startCliUnderTest();
    const eventName = uniqueKey();

    const result = await cli.run([
      "metrics",
      "create",
      "--event-name",
      eventName,
      "--value-field",
      "/items",
      "--kind",
      "conversion",
      "--direction",
      "higher-is-better",
    ]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toContain(
      "kinds: A metric with a value field needs value-per-context among its kinds",
    );
    expect(listedMetric(jsonOf(await cli.run(["metrics", "list", "--json"])), eventName)).toBeUndefined();
  });

  it("exits 2 listing both metrics by id and name when metrics get names an event name two metrics share", async () => {
    const cli = await startCliUnderTest();
    const everyCheckout = await createConversionMetric(cli);
    const teamCheckout = await createTeamPlanItemsMetric(cli, everyCheckout.eventName);

    const result = await cli.run(["metrics", "get", everyCheckout.eventName]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    const lines = result.stderr.split("\n");
    expect(lines[0]).toEqual(
      `Error: 2 metrics in ${cli.project.slug} have the event name "${everyCheckout.eventName}". Name one with --id:`,
    );
    expect(lines.slice(1)).toHaveLength(3);
    expect(lines.slice(1)).toEqual(
      expect.arrayContaining([
        `  ${everyCheckout.id}   ${everyCheckout.eventName}`,
        `  ${teamCheckout.id}   ${everyCheckout.eventName} · /plan is one of [team] · value from /items`,
        "",
      ]),
    );
  });

  it("shows the metric metrics get --id names among two on one event name", async () => {
    const cli = await startCliUnderTest();
    const everyCheckout = await createConversionMetric(cli);
    const teamCheckout = await createTeamPlanItemsMetric(cli, everyCheckout.eventName);

    const result = await cli.run(["metrics", "get", "--id", teamCheckout.id]);

    expect(result.exitCode).toEqual(0);
    expect(result.stdout.split("\n")).toEqual([
      `${everyCheckout.eventName} · /plan is one of [team] · value from /items`,
      "  Kinds: value per context",
      "  Direction: higher is better",
      "",
      "No experiment uses it.",
      "",
    ]);
  });

  it("exits 2 and changes neither metric when metrics update names an event name two metrics share", async () => {
    const cli = await startCliUnderTest();
    const everyCheckout = await createConversionMetric(cli);
    const teamCheckout = await createTeamPlanItemsMetric(cli, everyCheckout.eventName);

    const result = await cli.run([
      "metrics",
      "update",
      everyCheckout.eventName,
      "--direction",
      "lower-is-better",
    ]);

    expect(result.exitCode).toEqual(2);
    expect(result.stderr).toContain(`  ${everyCheckout.id}   ${everyCheckout.eventName}\n`);
    expect(result.stderr).toContain(
      `  ${teamCheckout.id}   ${everyCheckout.eventName} · /plan is one of [team]`,
    );
    expect(jsonOf(await cli.run(["metrics", "get", "--id", everyCheckout.id, "--json"]))).toEqual(
      expect.objectContaining({ direction: "higher-is-better" }),
    );
    expect(jsonOf(await cli.run(["metrics", "get", "--id", teamCheckout.id, "--json"]))).toEqual(
      expect.objectContaining({ direction: "higher-is-better" }),
    );
  });

  it("changes only the metric metrics update --id names among two on one event name", async () => {
    const cli = await startCliUnderTest();
    const everyCheckout = await createConversionMetric(cli);
    const teamCheckout = await createTeamPlanItemsMetric(cli, everyCheckout.eventName);

    const result = await cli.run([
      "metrics",
      "update",
      "--id",
      teamCheckout.id,
      "--direction",
      "lower-is-better",
    ]);

    expect(result.exitCode).toEqual(0);
    expect(jsonOf(await cli.run(["metrics", "get", "--id", teamCheckout.id, "--json"]))).toEqual(
      expect.objectContaining({ direction: "lower-is-better" }),
    );
    expect(jsonOf(await cli.run(["metrics", "get", "--id", everyCheckout.id, "--json"]))).toEqual(
      expect.objectContaining({ direction: "higher-is-better" }),
    );
  });

  it("exits 2 and deletes neither metric when metrics delete names an event name two metrics share", async () => {
    const cli = await startCliUnderTest();
    const everyCheckout = await createConversionMetric(cli);
    const teamCheckout = await createTeamPlanItemsMetric(cli, everyCheckout.eventName);

    const result = await cli.run(["metrics", "delete", everyCheckout.eventName]);

    expect(result.exitCode).toEqual(2);
    expect(result.stderr).toContain(`  ${everyCheckout.id}   ${everyCheckout.eventName}\n`);
    expect(result.stderr).toContain(
      `  ${teamCheckout.id}   ${everyCheckout.eventName} · /plan is one of [team]`,
    );
    expect(listedMetricIds(jsonOf(await cli.run(["metrics", "list", "--json"])))).toEqual(
      expect.arrayContaining([everyCheckout.id, teamCheckout.id]),
    );
  });

  it("deletes only the metric metrics delete --id names among two on one event name", async () => {
    const cli = await startCliUnderTest();
    const everyCheckout = await createConversionMetric(cli);
    const teamCheckout = await createTeamPlanItemsMetric(cli, everyCheckout.eventName);

    const result = await cli.run(["metrics", "delete", "--id", teamCheckout.id, "--json"]);

    expect(result.exitCode).toEqual(0);
    expect(jsonOf(result)).toEqual({
      deletedMetricId: teamCheckout.id,
      deletedEventName: everyCheckout.eventName,
    });
    const remainingIds = listedMetricIds(jsonOf(await cli.run(["metrics", "list", "--json"])));
    expect(remainingIds).toContain(everyCheckout.id);
    expect(remainingIds).not.toContain(teamCheckout.id);
  });
});
