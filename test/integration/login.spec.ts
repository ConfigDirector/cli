import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { startCliUnderTest } from "./support/built-cli.js";

describe.skipIf(adminApiUnderTest() === undefined)("login against the Admin API", () => {
  it("saves a sign-in for the token's organization after describing the token", async () => {
    const cli = await startCliUnderTest();
    const signInsFile = join(cli.sandbox.homeDirectory, ".config", "configdirector", "sign-ins.json");

    const result = await cli.run(["login", "--token", cli.adminApi.token]);

    expect(result.exitCode).toEqual(0);
    expect(JSON.parse(await readFile(signInsFile, "utf8"))).toEqual({
      signIns: [
        {
          organization: { id: cli.project.organizationId, name: expect.any(String) },
          token: cli.adminApi.token,
        },
      ],
    });
  });
});
