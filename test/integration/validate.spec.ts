import { describe, expect, it } from "vitest";
import { writeRepositoryFile } from "../support/repository-files.js";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { startCliUnderTest, uniqueKey } from "./support/built-cli.js";
import { checkoutFileReading, createBooleanFlag } from "./support/fixtures.js";

type ValidateOutput = { findings: { kind: string; key: string }[] };

describe.skipIf(adminApiUnderTest() === undefined)("validate against the Admin API", () => {
  it("exits 0 with no findings when every key the code reads is a config of the project", async () => {
    const cli = await startCliUnderTest();
    const key = await createBooleanFlag(cli);
    await writeRepositoryFile(cli.sandbox.workingDirectory, "src/checkout.ts", checkoutFileReading(key));

    const result = await cli.run(["validate", "--json"]);

    expect(result.exitCode).toEqual(0);
    expect((JSON.parse(result.stdout) as ValidateOutput).findings).toEqual([]);
  });

  it("exits 1 reporting a key no config of the project has", async () => {
    const cli = await startCliUnderTest();
    const unknownKey = uniqueKey();
    await writeRepositoryFile(
      cli.sandbox.workingDirectory,
      "src/checkout.ts",
      checkoutFileReading(unknownKey),
    );

    const result = await cli.run(["validate", "--json"]);

    expect(result.exitCode).toEqual(1);
    expect((JSON.parse(result.stdout) as ValidateOutput).findings).toEqual([
      expect.objectContaining({ kind: "unknown-key", key: unknownKey }),
    ]);
  });
});
