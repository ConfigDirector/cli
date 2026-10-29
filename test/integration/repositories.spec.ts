import { describe, expect, it } from "vitest";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest, uniqueRepositoryName } from "./support/built-cli.js";
import { createBooleanFlag, uploadScanOf } from "./support/fixtures.js";

type ListedScannedRepository = { name: string };

const listedNames = (repositories: unknown): string[] =>
  (repositories as ListedScannedRepository[]).map((repository) => repository.name);

describe.skipIf(adminApiUnderTest() === undefined)("repositories against the Admin API", () => {
  it("lists an uploaded repository with its commit, scan time and reference counts", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);
    const repositoryName = await uploadScanOf(cli, key);

    const repositories = jsonOf(
      await cli.run(["repositories", "list", "--json"]),
    ) as ListedScannedRepository[];

    expect(repositories.find((repository) => repository.name === repositoryName)).toEqual(
      expect.objectContaining({
        name: repositoryName,
        commit: "",
        scannedAt: expect.any(String),
        referenceCount: 1,
        dynamicReferenceCount: 0,
      }),
    );
  });

  it("removes a scanned repository so the project no longer lists it", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);
    const repositoryName = await uploadScanOf(cli, key);

    const result = await cli.run(["repositories", "remove", repositoryName, "--json"]);

    expect(result.exitCode).toEqual(0);
    expect(JSON.parse(result.stdout)).toEqual({ removedRepository: repositoryName });
    expect(listedNames(jsonOf(await cli.run(["repositories", "list", "--json"])))).not.toContain(
      repositoryName,
    );
  });

  it("exits 2 saying no scanned repository has the name when repositories remove names a missing one", async () => {
    const cli = await startCliUnderTest();
    const repositoryName = uniqueRepositoryName();

    const result = await cli.run(["repositories", "remove", repositoryName]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toContain(
      `Error: No scanned repository in ${cli.project.slug} has the name "${repositoryName}".`,
    );
  });
});
