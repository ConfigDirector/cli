import { describe, expect, it } from "vitest";
import { writeRepositoryFile } from "../support/repository-files.js";
import { adminApiUnderTest, firstEnvironmentOf } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest, uniqueKey } from "./support/built-cli.js";
import { createBooleanFlag, proPlanRulesFile } from "./support/fixtures.js";

type ConfigWithTargets = {
  targets: { environment: { slug: string }; rules: object[]; defaultValue: string }[];
};

type TargetingRulesReference = { conditionKinds: string[]; operatorsByTargetType: Record<string, string[]> };

describe.skipIf(adminApiUnderTest() === undefined)("targeting-rules against the Admin API", () => {
  it("replaces a config's targeting rules in one environment with the rules of a file", async () => {
    const cli = await startCliUnderTest();
    const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
    const key = await createBooleanFlag(cli);
    await writeRepositoryFile(cli.sandbox.workingDirectory, "rules.json", JSON.stringify(proPlanRulesFile));

    const result = await cli.run([
      "targeting-rules",
      "set",
      key,
      "--environment",
      environment.slug,
      "--rules",
      "rules.json",
    ]);

    expect(result.exitCode).toEqual(0);
    const config = jsonOf(await cli.run(["configs", "get", key, "--json"])) as ConfigWithTargets;
    const target = config.targets.find((candidate) => candidate.environment.slug === environment.slug);
    expect(target?.rules).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: "conditional",
        target: "value",
        value: true,
        conditions: [
          expect.objectContaining({ id: expect.any(String), trait: "/plan", targetValues: ["pro"] }),
        ],
      }),
    ]);
  });

  it("exits 2 saying no config has the key when targeting-rules set names a missing config", async () => {
    const cli = await startCliUnderTest();
    const environment = await firstEnvironmentOf(cli.adminApi, cli.project);
    const key = uniqueKey();
    await writeRepositoryFile(cli.sandbox.workingDirectory, "rules.json", JSON.stringify(proPlanRulesFile));

    const result = await cli.run([
      "targeting-rules",
      "set",
      key,
      "--environment",
      environment.slug,
      "--rules",
      "rules.json",
    ]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No config in ${cli.project.slug} has the key "${key}".\n`);
  });

  it("shows the condition kinds and the operators of each target type", async () => {
    const cli = await startCliUnderTest();

    const reference = jsonOf(
      await cli.run(["targeting-rules", "reference", "--json"]),
    ) as TargetingRulesReference;

    expect(reference.conditionKinds).toEqual(expect.arrayContaining(["attribute", "segment"]));
    expect(reference.operatorsByTargetType.text).toEqual(expect.arrayContaining(["is one of"]));
  });
});
