import { describe, expect, it } from "vitest";
import {
  adminApiUnderTest,
  attachPrimaryConversionMetric,
  firstEnvironmentOf,
} from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest } from "./support/built-cli.js";
import { createConversionMetric, createExperiment, setEvenSplit } from "./support/fixtures.js";

type ConfigWithTargets = {
  variations: { id: string; name: string; value: string }[];
  targets: { environment: { slug: string }; rules: unknown[]; defaultValue: string }[];
};

type Run = {
  endedAt?: string;
  outcome?: string;
  hypothesis?: string;
  note?: string;
  results: { rollouts: { state: string }[]; primary: { eventName: string }[] };
  shippedVariationId?: string;
  startedBy: { sourceClient: string };
  endedBy?: { sourceClient: string };
  rollouts: { ruleId: string }[];
  exposures: { rollouts: { ruleId: string; exposures: number; verdict: string }[] };
};

describe.skipIf(adminApiUnderTest() === undefined)(
  "configs runs, ship and stop against the Admin API",
  () => {
    it("lists the run a percentage rollout started, with no exposures yet", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);
      await setEvenSplit(cli, key, environment.slug);

      const listing = await cli.run(["configs", "runs", key, "--environment", environment.slug]);
      const runs = jsonOf(
        await cli.run(["configs", "runs", key, "--environment", environment.slug, "--json"]),
      ) as Run[];

      expect(listing.exitCode).toEqual(0);
      const listingLines = listing.stdout.split("\n");
      expect(listingLines[2]).toMatch(/^Running since \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      expect(listingLines.slice(3, 7)).toEqual([
        "  Rollout: everyone not caught by a rule above",
        "    control (Start free trial)              0 exposures   configured 50%",
        "    treatment-a (Try it free for 14 days)   0 exposures   configured 50%",
        "    0 contexts exposed, 0 evaluations. The run needs more exposures before the split can be checked against the configured shares.",
      ]);
      expect(runs).toEqual([
        expect.objectContaining({
          startedBy: expect.objectContaining({ sourceClient: "cli" }),
          rollouts: [expect.objectContaining({ ruleId: expect.any(String) })],
        }),
      ]);
      expect(runs[0]?.endedAt).toBeUndefined();
    });

    it("prints the results of the experiment's primary metric, which needs more exposures in a run just started", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const metric = await createConversionMetric(cli);
      const key = await createExperiment(cli);
      await attachPrimaryConversionMetric(cli.adminApi, cli.project, key, metric.id);
      await setEvenSplit(cli, key, environment.slug);

      const listing = await cli.run(["configs", "runs", key, "--environment", environment.slug]);
      const runs = jsonOf(
        await cli.run(["configs", "runs", key, "--environment", environment.slug, "--json"]),
      ) as Run[];

      expect(listing.exitCode).toEqual(0);
      expect(listing.stdout.split("\n").slice(7)).toEqual([
        "    The run needs more exposures before the variations can be compared.",
        `    Primary metric: ${metric.eventName}, conversion, higher is better`,
        "      control (Start free trial)              0.0%   control",
        "      treatment-a (Try it free for 14 days)   0.0%",
        "  Results can be up to 25 minutes behind.",
        "",
      ]);
      expect(runs[0]?.results).toEqual(
        expect.objectContaining({
          rollouts: [expect.objectContaining({ state: "needs-more-exposures" })],
          primary: [expect.objectContaining({ eventName: metric.eventName })],
        }),
      );
    });

    it("copies the hypothesis --hypothesis gave the experiment onto the run its rollout starts", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli, [
        "--hypothesis",
        "Urgency copy raises checkout completion by 5%",
      ]);

      await setEvenSplit(cli, key, environment.slug);

      expect(
        jsonOf(await cli.run(["configs", "runs", key, "--environment", environment.slug, "--json"])),
      ).toEqual([expect.objectContaining({ hypothesis: "Urgency copy raises checkout completion by 5%" })]);
    });

    it("ships with --note: the ended run keeps the note", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);
      await setEvenSplit(cli, key, environment.slug);

      const result = await cli.run([
        "configs",
        "ship",
        key,
        "--environment",
        environment.slug,
        "--variation",
        "treatment-a",
        "--note",
        "Checkout completion rose",
      ]);

      expect(result.exitCode).toEqual(0);
      expect(
        jsonOf(await cli.run(["configs", "runs", key, "--environment", environment.slug, "--json"])),
      ).toEqual([expect.objectContaining({ outcome: "shipped", note: "Checkout completion rose" })]);
    });

    it("stops with --note: the ended run keeps the note", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);
      await setEvenSplit(cli, key, environment.slug);

      const result = await cli.run([
        "configs",
        "stop",
        key,
        "--environment",
        environment.slug,
        "--note",
        "Support tickets rose with the new copy",
      ]);

      expect(result.exitCode).toEqual(0);
      expect(
        jsonOf(await cli.run(["configs", "runs", key, "--environment", environment.slug, "--json"])),
      ).toEqual([
        expect.objectContaining({ outcome: "stopped", note: "Support tickets rose with the new copy" }),
      ]);
    });

    it("ships a variation named by --variation: the targets are saved and the run ends as shipped by the CLI", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);
      await setEvenSplit(cli, key, environment.slug);

      const result = await cli.run([
        "configs",
        "ship",
        key,
        "--environment",
        environment.slug,
        "--variation",
        "treatment-a",
      ]);

      expect(result.exitCode).toEqual(0);
      expect(result.stdout.split("\n")[0]).toContain("Shipped treatment-a (Try it free for 14 days) in");
      const config = jsonOf(await cli.run(["configs", "get", key, "--json"])) as ConfigWithTargets;
      const target = config.targets.find((candidate) => candidate.environment.slug === environment.slug);
      expect(target).toEqual(expect.objectContaining({ defaultValue: "Try it free for 14 days", rules: [] }));
      const treatment = config.variations.find((variation) => variation.name === "treatment-a");
      expect(
        jsonOf(await cli.run(["configs", "runs", key, "--environment", environment.slug, "--json"])),
      ).toEqual([
        expect.objectContaining({
          outcome: "shipped",
          shippedVariationId: treatment?.id,
          endedBy: expect.objectContaining({ sourceClient: "cli" }),
        }),
      ]);
    });

    it("ships a variation named by its id", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);
      await setEvenSplit(cli, key, environment.slug);
      const { variations } = jsonOf(await cli.run(["configs", "get", key, "--json"])) as ConfigWithTargets;
      const treatment = variations.find((variation) => variation.name === "treatment-a");

      const result = await cli.run([
        "configs",
        "ship",
        key,
        "--environment",
        environment.slug,
        "--variation",
        String(treatment?.id),
      ]);

      expect(result.exitCode).toEqual(0);
      const config = jsonOf(await cli.run(["configs", "get", key, "--json"])) as ConfigWithTargets;
      expect(config.targets.find((candidate) => candidate.environment.slug === environment.slug)).toEqual(
        expect.objectContaining({ defaultValue: "Try it free for 14 days", rules: [] }),
      );
    });

    it("exits 2 listing the variations when --variation names none, leaving the rollout saved", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);
      await setEvenSplit(cli, key, environment.slug);

      const result = await cli.run([
        "configs",
        "ship",
        key,
        "--environment",
        environment.slug,
        "--variation",
        "treatment-z",
      ]);

      expect(result.exitCode).toEqual(2);
      expect(result.stderr).toContain(`${key} has no variation named or with the id "treatment-z"`);
      const config = jsonOf(await cli.run(["configs", "get", key, "--json"])) as ConfigWithTargets;
      const target = config.targets.find((candidate) => candidate.environment.slug === environment.slug);
      expect(target?.rules).toHaveLength(1);
    });

    it("stops a run: the rollout goes, the default targeting rule value stays and the run ends as stopped by the CLI", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);
      await setEvenSplit(cli, key, environment.slug);

      const result = await cli.run(["configs", "stop", key, "--environment", environment.slug]);

      expect(result.exitCode).toEqual(0);
      expect(result.stdout.split("\n")[0]).toContain(`Stopped the run of ${key} in`);
      const config = jsonOf(await cli.run(["configs", "get", key, "--json"])) as ConfigWithTargets;
      expect(config.targets.find((candidate) => candidate.environment.slug === environment.slug)).toEqual(
        expect.objectContaining({ defaultValue: "Start free trial", rules: [] }),
      );
      expect(
        jsonOf(await cli.run(["configs", "runs", key, "--environment", environment.slug, "--json"])),
      ).toEqual([
        expect.objectContaining({
          outcome: "stopped",
          endedBy: expect.objectContaining({ sourceClient: "cli" }),
        }),
      ]);
    });

    it("exits 2 with ConfigDirector's reason when the environment holds no rollout to stop", async () => {
      const cli = await startCliUnderTest();
      const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
      const key = await createExperiment(cli);

      const result = await cli.run(["configs", "stop", key, "--environment", environment.slug]);

      expect(result.exitCode).toEqual(2);
      expect(result.stdout).toEqual("");
      expect(result.stderr).toContain("environmentId");
    });
  },
);
