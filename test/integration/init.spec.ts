import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { startCliUnderTest } from "./support/built-cli.js";

describe.skipIf(adminApiUnderTest() === undefined)("init against the Admin API", () => {
  it("links the directory to the project and the organization the token finds it in", async () => {
    const cli = await startCliUnderTest();
    const settingsFile = join(cli.sandbox.workingDirectory, "configdirector.json");

    const result = await cli.run(["init"]);

    expect(result.exitCode).toEqual(0);
    expect(JSON.parse(await readFile(settingsFile, "utf8"))).toEqual({
      project: cli.project.slug,
      organization: cli.project.organizationId,
      include: ["**"],
      exclude: [],
      ignoreKeys: [],
    });
  });
});
