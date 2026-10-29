import { describe, expect, it } from "vitest";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest } from "./support/built-cli.js";

type ListedProject = { slug: string };

describe.skipIf(adminApiUnderTest() === undefined)("projects list against the Admin API", () => {
  it("lists the project under test among the organization's projects", async () => {
    const cli = await startCliUnderTest();

    const result = await cli.run(["projects", "list", "--json"]);

    const projects = jsonOf(result) as ListedProject[];
    expect(projects.map((project) => project.slug)).toContain(cli.project.slug);
  });
});
