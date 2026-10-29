import { describe, expect, it } from "vitest";
import { writeRepositoryFile } from "../support/repository-files.js";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest } from "./support/built-cli.js";
import { checkoutFileReading, createBooleanFlag, uploadScanOf } from "./support/fixtures.js";

type ScanOutput = { project: string; references: { key: string; file: string; line: number }[] };

type ListedScannedRepository = { name: string; referenceCount: number; dynamicReferenceCount: number };

describe.skipIf(adminApiUnderTest() === undefined)("scan against the Admin API", () => {
  it("lists where the code reads a config of the project", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);
    await writeRepositoryFile(cli.sandbox.workingDirectory, "src/checkout.ts", checkoutFileReading(key));

    const scan = jsonOf(await cli.run(["scan", "--json"])) as ScanOutput;

    expect(scan.project).toEqual(cli.project.slug);
    expect(scan.references).toEqual([expect.objectContaining({ key, file: "src/checkout.ts", line: 4 })]);
  });

  it("uploads the scan as a scanned repository the project then lists with its reference count", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);

    const repositoryName = await uploadScanOf(cli, key);

    const repositories = jsonOf(
      await cli.run(["repositories", "list", "--json"]),
    ) as ListedScannedRepository[];

    expect(repositories.find((repository) => repository.name === repositoryName)).toEqual(
      expect.objectContaining({ name: repositoryName, referenceCount: 1, dynamicReferenceCount: 0 }),
    );
  });
});
