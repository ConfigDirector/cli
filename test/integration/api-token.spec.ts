import { describe, expect, it } from "vitest";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest } from "./support/built-cli.js";

describe.skipIf(adminApiUnderTest() === undefined)("api-token get against the Admin API", () => {
  it("describes the token's name, organization and permissions", async () => {
    const cli = await startCliUnderTest();

    const result = await cli.run(["api-token", "get", "--json"]);

    expect(jsonOf(result)).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        organization: { id: cli.project.organizationId, name: expect.any(String) },
        permissions: expect.arrayContaining(["projects:read"]),
      }),
    );
  });
});
