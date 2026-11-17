import { describe, expect, it } from "vitest";
import { adminApiUnderTest, projectAccessUnderTest } from "./support/admin-api-under-test.js";
import { startCliUnderTest, uniqueKey } from "./support/built-cli.js";

describe.skipIf(adminApiUnderTest() === undefined)("project selection against the Admin API", () => {
  it("exits 2 saying no project in the token's organization has a slug that matches none, for a token with all projects", async ({
    skip,
  }) => {
    const cli = await startCliUnderTest();
    const projectAccess = await projectAccessUnderTest(cli.adminApi);
    skip(projectAccess.kind !== "all", "The token is limited to selected projects.");
    const slug = uniqueKey();

    const result = await cli.run(["configs", "list", "--project", slug]);

    expect(result.exitCode).toEqual(2);
    expect(result.stderr).toEqual(
      `Error: No project in the API token's organization has the slug "${slug}".\n`,
    );
  });

  it("exits 2 saying the project may be outside the project access of a token limited to selected projects", async ({
    skip,
  }) => {
    const cli = await startCliUnderTest();
    const projectAccess = await projectAccessUnderTest(cli.adminApi);
    skip(projectAccess.kind !== "selected", "The token reaches every project.");
    const slug = uniqueKey();

    const result = await cli.run(["configs", "list", "--project", slug]);

    expect(result.exitCode).toEqual(2);
    expect(result.stderr).toEqual(
      `Error: No project the API token can reach has the slug "${slug}". ` +
        "The token is limited to selected projects, so the project may be outside its project access.\n",
    );
  });
});
