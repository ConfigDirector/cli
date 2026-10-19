import { isJsonObject, type JsonObject } from "../file-contents.js";
import type { Invocation } from "../Invocation.js";
import { readRequestFile, withId } from "../request-file.js";

export const readSegmentFile = (segmentArgument: string, invocation: Invocation): Promise<JsonObject> =>
  readRequestFile(
    "--segment",
    segmentArgument,
    invocation,
    'It takes {"key": ..., "name": ..., "groups": [...]}, like the output of segments get --json.',
  );

const conditionWithId = (condition: unknown): unknown =>
  isJsonObject(condition) ? withId(condition) : condition;

const conditionGroupWithIds = (group: unknown): unknown =>
  Array.isArray(group) ? group.map(conditionWithId) : group;

const conditionGroupsWithIds = (groups: unknown[]): unknown[] => groups.map(conditionGroupWithIds);

const overridesWithIds = (overrides: JsonObject): JsonObject =>
  Object.fromEntries(
    Object.entries(overrides).map(([environmentId, groups]) => [
      environmentId,
      Array.isArray(groups) ? conditionGroupsWithIds(groups) : groups,
    ]),
  );

export const withGeneratedConditionIds = (segment: JsonObject): JsonObject => ({
  ...segment,
  ...(Array.isArray(segment.groups) ? { groups: conditionGroupsWithIds(segment.groups) } : {}),
  ...(isJsonObject(segment.overrides) ? { overrides: overridesWithIds(segment.overrides) } : {}),
});
