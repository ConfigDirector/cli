import { ifPermitted } from "../admin-api/admin-api-errors.js";
import type { AdminApiClient, Project } from "../admin-api/AdminApiClient.js";
import type { Segment, SegmentDefinition } from "../admin-api/segments.js";
import { alignedColumns } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { plural } from "../plural.js";
import { connectToLinkedProject } from "../project-selection.js";
import { segmentText } from "../segments/segment-text.js";

const usageDescription = (segment: Segment): string =>
  `used by ${segment.usages.length} ${plural(segment.usages.length, "config", "configs")}`;

const segmentLines = (projectSlug: string, segments: Segment[]): string[] =>
  segments.length === 0
    ? [`No segments found in ${projectSlug}.`]
    : alignedColumns(segments.map((segment) => [segment.key, segment.name, usageDescription(segment)]));

export const listSegments = async (context: CommandContext): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: segments, responseBody } = await client.listSegments(project.id);

  return {
    json: responseBody,
    text: [...segmentLines(project.slug, segments), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};

const environmentSlugsFor = async (
  client: AdminApiClient,
  project: Project,
  segment: SegmentDefinition,
): Promise<ReadonlyMap<string, string>> => {
  if (Object.keys(segment.overrides).length === 0) {
    return new Map();
  }
  const environments = await ifPermitted(client.listEnvironments(project.id));
  return new Map((environments?.parsedBody ?? []).map((environment) => [environment.id, environment.slug]));
};

export const getSegment = async (
  context: CommandContext,
  [segmentKey]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const receivedSegment = await client.getSegment(project.id, segmentKey);
  if (receivedSegment === undefined) {
    throw new CliError(`No segment in ${project.slug} has the key "${segmentKey}".`);
  }
  const { parsedBody: segment, responseBody } = receivedSegment;

  return {
    json: responseBody,
    text: segmentText(segment, await environmentSlugsFor(client, project, segment)),
    exitCode: ExitCode.success,
  };
};
