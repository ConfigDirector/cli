import { productionEnvironment, testEnvironment } from "./evaluate-admin-api.js";
import { webApp } from "./scan-admin-api.js";
import { startStubAdminApi, type StubReply } from "./stub-admin-api.js";

export const projectPath = (path: string) => `/v1/projects/${webApp.id}${path}`;

export const startBrowseAdminApi = (repliesByProjectPath: Record<string, StubReply> = {}) =>
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

export const requestLinesOf = (adminApi: Awaited<ReturnType<typeof startBrowseAdminApi>>) =>
  adminApi.receivedRequests.map((request) => `${request.method} ${request.path}`);
