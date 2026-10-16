import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { onTestFinished } from "vitest";

type StubReply = {
  status: number;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

type ReceivedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
};

export const startStubAdminApi = async (reply: StubReply, repliesByPath: Record<string, StubReply> = {}) => {
  const receivedRequests: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    receivedRequests.push({ method: request.method ?? "", path, headers: request.headers });
    const replyToPath = repliesByPath[path] ?? reply;
    response.writeHead(replyToPath.status, { "content-type": "application/json", ...replyToPath.headers });
    response.end(
      replyToPath.rawBody ?? (replyToPath.body === undefined ? "" : JSON.stringify(replyToPath.body)),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;

  return { baseUrl: `http://127.0.0.1:${port}`, receivedRequests };
};
