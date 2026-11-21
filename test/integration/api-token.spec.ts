import { describe, expect, it } from "vitest";
import {
  adminApiUnderTest,
  apiTokenKindUnderTest,
  projectAccessUnderTest,
} from "./support/admin-api-under-test.js";
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

  it("shows the kind of a user API token", async ({ skip }) => {
    const cli = await startCliUnderTest();
    const kind = await apiTokenKindUnderTest(cli.adminApi);
    skip(kind !== "user", "The token is an organization API token.");

    const result = await cli.run(["api-token", "get"]);

    expect(result.exitCode).toEqual(0);
    expect(result.stdout).toContain("\nKind: user API token\n");
  });

  it("shows the kind of an organization API token", async ({ skip }) => {
    const cli = await startCliUnderTest();
    const kind = await apiTokenKindUnderTest(cli.adminApi);
    skip(kind !== "organization", "The token is a user API token.");

    const result = await cli.run(["api-token", "get"]);

    expect(result.exitCode).toEqual(0);
    expect(result.stdout).toContain("\nKind: organization API token\n");
  });

  it("says a token with all projects reaches all projects", async ({ skip }) => {
    const cli = await startCliUnderTest();
    const projectAccess = await projectAccessUnderTest(cli.adminApi);
    skip(projectAccess.kind !== "all", "The token is limited to selected projects.");

    const result = await cli.run(["api-token", "get"]);

    expect(result.exitCode).toEqual(0);
    expect(result.stdout).toContain("\nProject access: all projects\n");
  });

  it("lists the selected projects of a token limited to them, the project under test among them", async ({
    skip,
  }) => {
    const cli = await startCliUnderTest();
    const projectAccess = await projectAccessUnderTest(cli.adminApi);
    skip(projectAccess.kind !== "selected", "The token reaches every project.");

    const result = await cli.run(["api-token", "get"]);

    const projectAccessLine = result.stdout.split("\n").find((line) => line.startsWith("Project access: "));
    expect(result.exitCode).toEqual(0);
    expect(projectAccessLine).toEqual(expect.stringMatching(/^Project access: selected projects \(.+\)$/));
    expect(projectAccessLine).toContain(cli.project.id);
  });
});
