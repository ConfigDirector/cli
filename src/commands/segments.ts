import { ifPermitted } from "../admin-api/admin-api-errors.js";
import type { AdminApiClient, Project } from "../admin-api/AdminApiClient.js";
import type { Segment, SegmentDefinition, SegmentUsage } from "../admin-api/segments.js";
import { alignedListing, type ListingOptions } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { plural } from "../plural.js";
import { connectToLinkedProject } from "../project-selection.js";
import { readSegmentFile, withGeneratedConditionIds } from "../segments/segment-file.js";
import { segmentText } from "../segments/segment-text.js";

const usageDescription = (segment: Segment): string =>
  `used by ${segment.usages.length} ${plural(segment.usages.length, "config", "configs")}`;

const SEGMENT_HEADER_ROW = ["KEY", "NAME", "USED BY"];

const segmentLines = (projectSlug: string, segments: Segment[], options: ListingOptions): string[] =>
  segments.length === 0
    ? [`No segments found in ${projectSlug}.`]
    : alignedListing(
        SEGMENT_HEADER_ROW,
        segments.map((segment) => [segment.key, segment.name, usageDescription(segment)]),
        options,
      );

export const listSegments = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: ListingOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: segments, responseBody } = await client.listSegments(project.id);

  return {
    json: responseBody,
    text: [...segmentLines(project.slug, segments, options), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};

const environmentSlugsById = async (
  client: AdminApiClient,
  project: Project,
): Promise<ReadonlyMap<string, string>> => {
  const environments = await ifPermitted(client.listEnvironments(project.id));
  return new Map((environments?.parsedBody ?? []).map((environment) => [environment.id, environment.slug]));
};

const overrideEnvironmentSlugsOf = async (
  client: AdminApiClient,
  project: Project,
  segment: SegmentDefinition,
): Promise<ReadonlyMap<string, string>> =>
  Object.keys(segment.overrides).length === 0 ? new Map() : environmentSlugsById(client, project);

const noSegmentWithKey = (project: Project, segmentKey: string): CliError =>
  new CliError(`No segment in ${project.slug} has the key "${segmentKey}".`);

export const getSegment = async (
  context: CommandContext,
  [segmentKey]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const receivedSegment = await client.getSegment(project.id, segmentKey);
  if (receivedSegment === undefined) {
    throw noSegmentWithKey(project, segmentKey);
  }
  const { parsedBody: segment, responseBody } = receivedSegment;

  return {
    json: responseBody,
    text: segmentText(segment, await overrideEnvironmentSlugsOf(client, project, segment)),
    exitCode: ExitCode.success,
  };
};

type SegmentFileOptions = { segment: string };

export const createSegment = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: SegmentFileOptions,
): Promise<CommandOutput> => {
  const requestedSegment = withGeneratedConditionIds(
    await readSegmentFile(options.segment, context.invocation),
  );
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: segment, responseBody } = await client.createSegment(project.id, requestedSegment);

  return {
    json: responseBody,
    text: [
      `Created segment ${segment.key} in ${project.slug}.`,
      segmentText(segment, await overrideEnvironmentSlugsOf(client, project, segment)),
    ].join("\n"),
    exitCode: ExitCode.success,
  };
};

export const updateSegment = async (
  context: CommandContext,
  [segmentKey]: readonly [string],
  options: SegmentFileOptions,
): Promise<CommandOutput> => {
  const requestedSegment = withGeneratedConditionIds(
    await readSegmentFile(options.segment, context.invocation),
  );
  const { client, project } = await connectToLinkedProject(context);
  const currentSegment = await client.getSegment(project.id, segmentKey);
  if (currentSegment === undefined) {
    throw noSegmentWithKey(project, segmentKey);
  }
  const updatedSegment = await client.updateSegment(project.id, segmentKey, {
    ...requestedSegment,
    id: currentSegment.parsedBody.id,
  });
  if (updatedSegment === undefined) {
    throw noSegmentWithKey(project, segmentKey);
  }
  const { parsedBody: segment, responseBody } = updatedSegment;

  return {
    json: responseBody,
    text: [
      `Updated segment ${segmentKey} in ${project.slug}.`,
      segmentText(segment, await overrideEnvironmentSlugsOf(client, project, segment)),
    ].join("\n"),
    exitCode: ExitCode.success,
  };
};

const usageLine = (usage: SegmentUsage, environmentSlugs: ReadonlyMap<string, string>): string => {
  const environmentNames = usage.environmentIds.map(
    (environmentId) => environmentSlugs.get(environmentId) ?? environmentId,
  );
  return `  ${usage.configKey} in ${environmentNames.join(", ")}`;
};

const segmentInUseError = (
  segmentKey: string,
  usages: SegmentUsage[],
  environmentSlugs: ReadonlyMap<string, string>,
): CliError =>
  new CliError(
    [
      `The targeting rules of ${usages.length} ${plural(usages.length, "config use", "configs use")} ` +
        `the segment ${segmentKey}, so it was not deleted:`,
      ...usages.map((usage) => usageLine(usage, environmentSlugs)),
      "Remove those segment conditions first, with configdirector targeting-rules set.",
    ].join("\n"),
  );

export const deleteSegment = async (
  context: CommandContext,
  [segmentKey]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const deletion = await client.deleteSegment(project.id, segmentKey);
  switch (deletion.outcome) {
    case "deleted":
      return {
        json: { deletedSegmentKey: segmentKey },
        text: [`Deleted segment ${segmentKey} from ${project.slug}.`, ""].join("\n"),
        exitCode: ExitCode.success,
      };
    case "not-found":
      throw noSegmentWithKey(project, segmentKey);
    case "in-use":
      throw segmentInUseError(segmentKey, deletion.usages, await environmentSlugsById(client, project));
  }
};
