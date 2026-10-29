import { describe, expect, it } from "vitest";
import { adminApiUnderTest, environmentsOf } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest } from "./support/built-cli.js";

describe.skipIf(adminApiUnderTest() === undefined)("environments list against the Admin API", () => {
  it("lists every environment of the project with its id, slug, name and live flag", async () => {
    const cli = await startCliUnderTest();
    const environments = await environmentsOf(cli.adminApi, cli.project);

    const result = await cli.run(["environments", "list", "--json"]);

    expect(jsonOf(result)).toEqual(
      environments.map((environment) =>
        expect.objectContaining({
          id: environment.id,
          slug: environment.slug,
          name: environment.name,
          live: environment.live,
        }),
      ),
    );
  });
});
