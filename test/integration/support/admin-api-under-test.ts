import { onTestFinished } from "vitest";

export type AdminApiUnderTest = { baseUrl: string; token: string };

export type ProjectUnderTest = { id: string; slug: string; organizationId: string };

type EnvironmentUnderTest = { id: string; slug: string; name: string; live: boolean };

export const SKIPPED_WITHOUT_VARIABLES =
  "The integration suite is skipped: CONFIGDIRECTOR_BASE_URL and CONFIGDIRECTOR_TOKEN name the Admin API to test against, and at least one is unset.";

const nonEmptyVariable = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

export const adminApiUnderTest = (): AdminApiUnderTest | undefined => {
  const baseUrl = nonEmptyVariable("CONFIGDIRECTOR_BASE_URL");
  const token = nonEmptyVariable("CONFIGDIRECTOR_TOKEN");
  return baseUrl === undefined || token === undefined ? undefined : { baseUrl, token };
};

const requestAdminApi = async (adminApi: AdminApiUnderTest, method: "GET" | "DELETE", path: string) => {
  const response = await fetch(`${adminApi.baseUrl}${path}`, {
    method,
    headers: { Accept: "application/json", Authorization: `Bearer ${adminApi.token}` },
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

const requireProjectBySlug = (projects: ProjectUnderTest[], slug: string): ProjectUnderTest => {
  const project = projects.find((listedProject) => listedProject.slug === slug);
  if (project === undefined) {
    throw new Error(
      `No project in the API token's organization has the slug "${slug}" (CONFIGDIRECTOR_PROJECT).`,
    );
  }
  return project;
};

const requireOnlyProject = (projects: ProjectUnderTest[]): ProjectUnderTest => {
  const [onlyProject] = projects;
  if (onlyProject === undefined || projects.length > 1) {
    throw new Error(
      `The API token's organization has ${projects.length} projects. ` +
        "Name the one to test in with CONFIGDIRECTOR_PROJECT.",
    );
  }
  return onlyProject;
};

export const projectUnderTest = async (adminApi: AdminApiUnderTest): Promise<ProjectUnderTest> => {
  const { status, body } = await requestAdminApi(adminApi, "GET", "/v1/projects");
  if (status !== 200) {
    throw new Error(`GET ${adminApi.baseUrl}/v1/projects answered HTTP ${status}: ${JSON.stringify(body)}`);
  }
  const projects = body as ProjectUnderTest[];
  const slug = nonEmptyVariable("CONFIGDIRECTOR_PROJECT");
  return slug === undefined ? requireOnlyProject(projects) : requireProjectBySlug(projects, slug);
};

export const environmentsOf = async (
  adminApi: AdminApiUnderTest,
  project: ProjectUnderTest,
): Promise<EnvironmentUnderTest[]> => {
  const { status, body } = await requestAdminApi(adminApi, "GET", `/v1/projects/${project.id}/environments`);
  if (status !== 200) {
    throw new Error(`Listing the environments of ${project.slug} answered HTTP ${status}.`);
  }
  return body as EnvironmentUnderTest[];
};

export const removeWhenTestFinishes = (adminApi: AdminApiUnderTest, path: string): void => {
  onTestFinished(async () => {
    const { status, body } = await requestAdminApi(adminApi, "DELETE", path);
    if (status !== 404 && (status < 200 || status >= 300)) {
      throw new Error(`Removing the fixture at ${path} answered HTTP ${status}: ${JSON.stringify(body)}`);
    }
  });
};

export const firstEnvironmentOf = async (
  adminApi: AdminApiUnderTest,
  project: ProjectUnderTest,
): Promise<EnvironmentUnderTest> => {
  const [firstEnvironment] = await environmentsOf(adminApi, project);
  if (firstEnvironment === undefined) {
    throw new Error(`The project ${project.slug} has no environments.`);
  }
  return firstEnvironment;
};
