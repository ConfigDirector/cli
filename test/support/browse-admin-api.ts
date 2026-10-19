import { productionEnvironment, testEnvironment } from "./evaluate-admin-api.js";
import { webApp } from "./scan-admin-api.js";
import { startStubAdminApi, type StubReplyForRequest } from "./stub-admin-api.js";

export const projectPath = (path: string) => `/v1/projects/${webApp.id}${path}`;

export const startBrowseAdminApi = (repliesByProjectPath: Record<string, StubReplyForRequest> = {}) =>
  startStubAdminApi(
    { status: 404, body: {} },
    {
      "/v1/projects": { status: 200, body: [webApp] },
      [projectPath("/environments")]: { status: 200, body: [testEnvironment, productionEnvironment] },
      ...Object.fromEntries(
        Object.entries(repliesByProjectPath).map(([path, reply]) => [projectPath(path), reply]),
      ),
    },
  );

const tagNamed = (id: string, name: string) => ({
  id,
  projectId: webApp.id,
  name,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
});

export const checkoutTag = tagNamed("5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "checkout");

export const webTeamTag = tagNamed("6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e", "Web team");

export const requestLinesOf = (adminApi: Awaited<ReturnType<typeof startBrowseAdminApi>>) =>
  adminApi.receivedRequests.map((request) => `${request.method} ${request.path}`);
