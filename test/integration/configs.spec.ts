import { describe, expect, it } from "vitest";
import { adminApiUnderTest, environmentsOf } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest, uniqueKey } from "./support/built-cli.js";
import { createBooleanFlag } from "./support/fixtures.js";

type ListedConfig = { key: string; type: string; state: string };

type ConfigWithTargets = {
  key: string;
  type: string;
  role: string;
  lifetime: string;
  targets: { environment: { slug: string }; rules: unknown[]; defaultValue: string }[];
};

const listedKeys = (configs: unknown): string[] => (configs as ListedConfig[]).map((config) => config.key);

describe.skipIf(adminApiUnderTest() === undefined)("configs against the Admin API", () => {
  it("creates a boolean flag the project then lists as new", async () => {
    const cli = await startCliUnderTest();

    const key = await createBooleanFlag(cli);

    const listed = jsonOf(await cli.run(["configs", "list", "--json"])) as ListedConfig[];

    expect(listed.find((config) => config.key === key)).toEqual(
      expect.objectContaining({ key, type: "boolean", state: "new" }),
    );
  });

  it("exits 1 naming the existing config when the key is already taken", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);

    const result = await cli.run([
      "configs",
      "create",
      "--key",
      key,
      "--type",
      "string",
      "--role",
      "config",
      "--lifetime",
      "permanent",
      "--default-value",
      "blue",
      "--json",
    ]);

    expect(result.exitCode).toEqual(1);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({ key, type: "boolean", role: "flag" }),
    );
  });

  it("lists only the configs in the requested lifecycle state", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);

    const newConfigs = jsonOf(await cli.run(["configs", "list", "--state", "new", "--json"]));
    const staleConfigs = jsonOf(await cli.run(["configs", "list", "--state", "stale", "--json"]));

    expect(listedKeys(newConfigs)).toContain(key);
    expect(listedKeys(staleConfigs)).not.toContain(key);
  });

  it("shows a config's settings and its default targeting rule value in every environment", async () => {
    const cli = await startCliUnderTest();
    const environments = await environmentsOf(cli.adminApi, cli.project);
    const key = await createBooleanFlag(cli);

    const config = jsonOf(await cli.run(["configs", "get", key, "--json"])) as ConfigWithTargets;

    expect(config).toEqual(
      expect.objectContaining({ key, type: "boolean", role: "flag", lifetime: "temporary" }),
    );
    expect(config.targets).toHaveLength(environments.length);
    expect(config.targets).toEqual(
      expect.arrayContaining(
        environments.map((environment) =>
          expect.objectContaining({
            environment: expect.objectContaining({ slug: environment.slug }),
            rules: [],
            defaultValue: "false",
          }),
        ),
      ),
    );
  });

  it("exits 2 saying no config has the key when configs get names a missing config", async () => {
    const cli = await startCliUnderTest();
    const key = uniqueKey();

    const result = await cli.run(["configs", "get", key]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No config in ${cli.project.slug} has the key "${key}".\n`);
  });

  it("shows no SDK evaluations for a config no SDK has evaluated", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);

    const activity = jsonOf(await cli.run(["configs", "activity", key, "--json"]));

    expect(activity).toEqual(expect.objectContaining({ latestEvaluations: [] }));
  });

  it("exits 2 saying no config has the key when configs activity names a missing config", async () => {
    const cli = await startCliUnderTest();
    const key = uniqueKey();

    const result = await cli.run(["configs", "activity", key]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No config in ${cli.project.slug} has the key "${key}".\n`);
  });

  it("archives a config so the project no longer lists it", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);

    const result = await cli.run(["configs", "archive", key, "--json"]);

    expect(result.exitCode).toEqual(0);
    expect(JSON.parse(result.stdout)).toEqual({ archivedConfigKey: key });
    expect(listedKeys(jsonOf(await cli.run(["configs", "list", "--json"])))).not.toContain(key);
  });

  it("exits 2 saying no config has the key when configs archive names a missing config", async () => {
    const cli = await startCliUnderTest();
    const key = uniqueKey();

    const result = await cli.run(["configs", "archive", key]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No config in ${cli.project.slug} has the key "${key}".\n`);
  });
});
