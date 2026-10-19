import { createServer, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { onTestFinished } from "vitest";

export type StubReply = {
  status: number;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

export type ReceivedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
};

export type StubReplyForRequest = StubReply | ((request: ReceivedRequest) => StubReply);

const readRequestBody = async (request: IncomingMessage): Promise<unknown> => {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
  }
  return text === "" ? undefined : JSON.parse(text);
};

export const startStubAdminApi = async (
  reply: StubReply,
  repliesByPath: Record<string, StubReplyForRequest> = {},
) => {
  const receivedRequests: ReceivedRequest[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url ?? "";
    const receivedRequest = {
      method: request.method ?? "",
      path,
      headers: request.headers,
      body: await readRequestBody(request),
    };
    receivedRequests.push(receivedRequest);
    const replyForRequest = repliesByPath[path] ?? reply;
    const replyToPath =
      typeof replyForRequest === "function" ? replyForRequest(receivedRequest) : replyForRequest;
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
