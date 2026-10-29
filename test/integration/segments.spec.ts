import { describe, expect, it } from "vitest";
import { writeRepositoryFile } from "../support/repository-files.js";
import { adminApiUnderTest } from "./support/admin-api-under-test.js";
import { jsonOf, startCliUnderTest, uniqueKey } from "./support/built-cli.js";
import { createSegment, emailCondition, segmentFileOf } from "./support/fixtures.js";

type ListedSegment = { key: string; name: string; usages: unknown[] };

type SegmentDefinition = { key: string; name: string; groups: object[][]; overrides: object };

const listedSegment = (segments: unknown, key: string) =>
  (segments as ListedSegment[]).find((segment) => segment.key === key);

describe.skipIf(adminApiUnderTest() === undefined)("segments against the Admin API", () => {
  it("creates a segment from a file that the project then lists as used by no config", async () => {
    const cli = await startCliUnderTest();

    const key = await createSegment(cli);

    const segments = jsonOf(await cli.run(["segments", "list", "--json"]));

    expect(listedSegment(segments, key)).toEqual(
      expect.objectContaining({ key, name: "Example staff", usages: [] }),
    );
  });

  it("shows a segment's condition groups with the ids the API gave the conditions", async () => {
    const cli = await startCliUnderTest();
    const key = await createSegment(cli);

    const segment = jsonOf(await cli.run(["segments", "get", key, "--json"])) as SegmentDefinition;

    expect(segment).toEqual(expect.objectContaining({ key, name: "Example staff", overrides: {} }));
    expect(segment.groups).toEqual([
      [expect.objectContaining({ id: expect.any(String), ...emailCondition })],
    ]);
  });

  it("exits 2 saying no segment has the key when segments get names a missing segment", async () => {
    const cli = await startCliUnderTest();
    const key = uniqueKey();

    const result = await cli.run(["segments", "get", key]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No segment in ${cli.project.slug} has the key "${key}".\n`);
  });

  it("replaces a segment's name and condition groups from a file", async () => {
    const cli = await startCliUnderTest();
    const key = await createSegment(cli);
    await writeRepositoryFile(
      cli.sandbox.workingDirectory,
      "renamed-segment.json",
      JSON.stringify(segmentFileOf(key, "Example staff, renamed")),
    );

    const result = await cli.run(["segments", "update", key, "--segment", "renamed-segment.json"]);

    expect(result.exitCode).toEqual(0);
    const segment = jsonOf(await cli.run(["segments", "get", key, "--json"])) as SegmentDefinition;
    expect(segment.name).toEqual("Example staff, renamed");
  });

  it("exits 2 saying no segment has the key when segments update names a missing segment", async () => {
    const cli = await startCliUnderTest();
    const key = uniqueKey();
    await writeRepositoryFile(
      cli.sandbox.workingDirectory,
      "segment.json",
      JSON.stringify(segmentFileOf(key, "Example staff")),
    );

    const result = await cli.run(["segments", "update", key, "--segment", "segment.json"]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No segment in ${cli.project.slug} has the key "${key}".\n`);
  });

  it("deletes a segment so the project no longer lists it", async () => {
    const cli = await startCliUnderTest();
    const key = await createSegment(cli);

    const result = await cli.run(["segments", "delete", key, "--json"]);

    expect(result.exitCode).toEqual(0);
    expect(JSON.parse(result.stdout)).toEqual({ deletedSegmentKey: key });
    expect(listedSegment(jsonOf(await cli.run(["segments", "list", "--json"])), key)).toBeUndefined();
  });

  it("exits 2 saying no segment has the key when segments delete names a missing segment", async () => {
    const cli = await startCliUnderTest();
    const key = uniqueKey();

    const result = await cli.run(["segments", "delete", key]);

    expect(result.exitCode).toEqual(2);
    expect(result.stdout).toEqual("");
    expect(result.stderr).toEqual(`Error: No segment in ${cli.project.slug} has the key "${key}".\n`);
  });
});
