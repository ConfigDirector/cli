import { describe, expect, it } from "vitest";
import { adminApiUnderTest, firstEnvironmentOf } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest, uniqueKey } from "./support/built-cli.js";
import { createBooleanFlag, setProPlanRule } from "./support/fixtures.js";

type ConfigEvaluation = { key: string; value: string; servedBy: { kind: string } };

describe.skipIf(adminApiUnderTest() === undefined)("evaluate against the Admin API", () => {
  it("serves the value of the rule a context's trait matches", async () => {
    const cli = await startCliUnderTest();
    const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
    const key = await createBooleanFlag(cli);
    await setProPlanRule(cli, key, environment.slug);

    const result = await cli.run([
      "evaluate",
      key,
      "--environment",
      environment.slug,
      "--context-id",
      "123",
      "--context-trait",
      "plan=pro",
      "--json",
    ]);

    const evaluation = jsonOf(result) as ConfigEvaluation;
    expect(evaluation).toEqual(
      expect.objectContaining({ key, value: "true", servedBy: { kind: "rule", ruleId: expect.any(String) } }),
    );
  });

  it("serves the default targeting rule value to a context no rule matches", async () => {
    const cli = await startCliUnderTest();
    const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
    const key = await createBooleanFlag(cli);
    await setProPlanRule(cli, key, environment.slug);

    const result = await cli.run([
      "evaluate",
      key,
      "--environment",
      environment.slug,
      "--context-id",
      "123",
      "--context-trait",
      "plan=free",
      "--json",
    ]);

    const evaluation = jsonOf(result) as ConfigEvaluation;
    expect(evaluation).toEqual(
      expect.objectContaining({ key, value: "false", servedBy: { kind: "default" } }),
    );
  });

  it("exits 2 naming the project's environments when the environment slug is missing", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);

    const result = await cli.run(["evaluate", key, "--environment", "no-such-environment"]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toContain(
      `Error: No environment in ${cli.project.slug} has the slug "no-such-environment". Its environments are `,
    );
  });

  it("exits 2 saying no config has the key when evaluate names a missing config", async () => {
    const cli = await startCliUnderTest();
    const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
    const key = uniqueKey();

    const result = await cli.run(["evaluate", key, "--environment", environment.slug]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No config in ${cli.project.slug} has the key "${key}".\n`);
  });
});
