import { startStubAdminApi } from "./stub-admin-api.js";

export const webApp = {
  id: "4f0c1d2e-8a51-4c3b-9b6e-2d7f8a9b0c1d",
  name: "Web App",
  slug: "web-app",
  organizationId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

type Project = typeof webApp;

type ConfigOverrides = {
  type?: string;
  typeOptions?: object | null;
  role?: string;
  lifetime?: string;
  state?: string;
  client?: boolean;
  server?: boolean;
};

export const projectConfig = (
  key: string,
  deprecatedKeys: string[] = [],
  overrides: ConfigOverrides = {},
) => ({
  id: `config-${key}`,
  projectId: webApp.id,
  key,
  type: "boolean",
  typeOptions: null,
  role: "flag",
  lifetime: "temporary",
  state: "in-use",
  client: true,
  server: true,
  ...overrides,
  deprecatedKeys: deprecatedKeys.map((deprecatedKey) => ({
    id: `key-${deprecatedKey}`,
    configId: `config-${key}`,
    key: deprecatedKey,
    isPrimary: false,
  })),
});

export type ProjectConfig = ReturnType<typeof projectConfig>;

type ScanAdminApiOptions = { configs?: ProjectConfig[]; projects?: Project[] };

export const startScanAdminApi = ({ configs = [], projects = [webApp] }: ScanAdminApiOptions = {}) =>
  startStubAdminApi(
    { status: 200, body: projects },
    Object.fromEntries(
      projects.map((project) => [`/v1/projects/${project.id}/configs`, { status: 200, body: configs }]),
    ),
  );
