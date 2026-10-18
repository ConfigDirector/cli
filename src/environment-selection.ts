import type { AdminApiClient, Environment, Project } from "./admin-api/AdminApiClient.js";
import { CliError } from "./CliError.js";

const environmentSlugsSentence = (environments: Environment[]): string =>
  environments.length === 0
    ? "The project has no environments."
    : `Its environments are ${environments.map((environment) => environment.slug).join(", ")}.`;

export const findEnvironmentBySlug = async (
  client: AdminApiClient,
  project: Project,
  slug: string,
): Promise<Environment> => {
  const { parsedBody: environments } = await client.listEnvironments(project.id);
  const environment = environments.find((listedEnvironment) => listedEnvironment.slug === slug);
  if (environment === undefined) {
    throw new CliError(
      `No environment in ${project.slug} has the slug "${slug}". ${environmentSlugsSentence(environments)}`,
    );
  }
  return environment;
};
