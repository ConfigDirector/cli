import { ifPermitted } from "../admin-api/admin-api-errors.js";
import type { AdminApiClient, Project } from "../admin-api/AdminApiClient.js";
import type { ListedScannedRepository } from "../admin-api/scanned-repositories.js";
import { alignedListing, type ListingOptions } from "../aligned-columns.js";
import { CliError } from "../CliError.js";
import type { CommandContext, CommandOutput } from "../CommandContext.js";
import { ExitCode } from "../ExitCode.js";
import { plural } from "../plural.js";
import { connectToLinkedProject } from "../project-selection.js";
import { shortCommit } from "../scanned-repository/short-commit.js";
import { utcMinute } from "../utc-minute.js";

const MAX_SCANNED_REPOSITORIES_PER_PROJECT = 50;

const commitDescription = (commit: string | null): string =>
  commit === null ? "no commit" : shortCommit(commit);

const SCANNED_REPOSITORY_HEADER_ROW = ["REPOSITORY", "COMMIT", "SCANNED", "REFERENCES", "DYNAMIC REFERENCES"];

const scannedRepositoryColumnsOf = (repository: ListedScannedRepository): string[] => [
  repository.name,
  commitDescription(repository.commit),
  utcMinute(repository.scannedAt),
  `${repository.referenceCount} ${plural(repository.referenceCount, "reference", "references")}`,
  `${repository.dynamicReferenceCount} ${plural(repository.dynamicReferenceCount, "dynamic reference", "dynamic references")}`,
];

const scannedRepositoryLines = (
  projectSlug: string,
  repositories: ListedScannedRepository[],
  options: ListingOptions,
): string[] =>
  repositories.length === 0
    ? [
        `No scanned repositories found in ${projectSlug}. ` +
          "Run configdirector scan --upload in a repository to upload its code references.",
      ]
    : [
        ...alignedListing(
          SCANNED_REPOSITORY_HEADER_ROW,
          repositories.map(scannedRepositoryColumnsOf),
          options,
        ),
        "",
        `${projectSlug} has ${repositories.length} of the ${MAX_SCANNED_REPOSITORIES_PER_PROJECT} ` +
          "scanned repositories a project can hold.",
      ];

export const listScannedRepositories = async (
  context: CommandContext,
  _commandArguments: readonly [],
  options: ListingOptions,
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const { parsedBody: repositories, responseBody } = await client.listScannedRepositories(project.id);

  return {
    json: responseBody,
    text: [...scannedRepositoryLines(project.slug, repositories, options), ""].join("\n"),
    exitCode: ExitCode.success,
  };
};

const scannedRepositoryNamesSentence = (repositories: ListedScannedRepository[]): string =>
  repositories.length === 0
    ? "The project has no scanned repositories."
    : `Its scanned repositories are ${repositories.map((repository) => repository.name).join(", ")}.`;

const scannedRepositoryNotFoundError = async (
  client: AdminApiClient,
  project: Project,
  repositoryName: string,
): Promise<CliError> => {
  const repositories = await ifPermitted(client.listScannedRepositories(project.id));
  return new CliError(
    [
      `No scanned repository in ${project.slug} has the name "${repositoryName}".`,
      ...(repositories === undefined ? [] : [scannedRepositoryNamesSentence(repositories.parsedBody)]),
    ].join(" "),
  );
};

export const removeScannedRepository = async (
  context: CommandContext,
  [repositoryName]: readonly [string],
): Promise<CommandOutput> => {
  const { client, project } = await connectToLinkedProject(context);
  const outcome = await client.removeScannedRepository(project.id, repositoryName);
  if (outcome === "not-found") {
    throw await scannedRepositoryNotFoundError(client, project, repositoryName);
  }

  return {
    json: { removedRepository: repositoryName },
    text: [`Removed ${repositoryName} and its code references from ${project.slug}.`, ""].join("\n"),
    exitCode: ExitCode.success,
  };
};
