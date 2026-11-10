import { describe, expect, it } from "vitest";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest, uniqueKey } from "./support/built-cli.js";
import { createConversionMetric } from "./support/fixtures.js";

type ListedMetric = { id: string; eventName: string; kinds: string[]; direction: string; usages: unknown[] };

const listedMetric = (metrics: unknown, eventName: string) =>
  (metrics as ListedMetric[]).find((metric) => metric.eventName === eventName);

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
    expect(jsonOf(result)).toEqual({ deletedEventName: metric.eventName });
    expect(
      listedMetric(jsonOf(await cli.run(["metrics", "list", "--json"])), metric.eventName),
    ).toBeUndefined();
  });
});
