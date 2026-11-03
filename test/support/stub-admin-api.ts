import { createServer, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { onTestFinished } from "vitest";

type AnsweredStubReply = {
  status: number;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  thenRefuseConnectionsForMilliseconds?: number;
};

type DroppedConnection = "reset" | "closed";

export const connectionReset = { droppedConnection: "reset" } as const;

export const connectionClosed = { droppedConnection: "closed" } as const;

export type StubReply = AnsweredStubReply | typeof connectionReset | typeof connectionClosed;

export type ReceivedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
};

export type StubReplyForRequest = StubReply | ((request: ReceivedRequest) => StubReply);

export const firstReplyThen = (first: StubReply, then: StubReply) => {
  let requestsReceived = 0;
  return (): StubReply => {
    requestsReceived += 1;
    return requestsReceived === 1 ? first : then;
  };
};

const dropConnection: { [Dropped in DroppedConnection]: (socket: Socket) => void } = {
  reset: (socket) => socket.resetAndDestroy(),
  closed: (socket) => socket.destroy(),
};

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
    if ("droppedConnection" in replyToPath) {
      dropConnection[replyToPath.droppedConnection](request.socket);
      return;
    }
    const refusalMilliseconds = replyToPath.thenRefuseConnectionsForMilliseconds;
    const connectionHeaders = refusalMilliseconds === undefined ? {} : { connection: "close" };
    response.writeHead(replyToPath.status, {
      "content-type": "application/json",
      ...connectionHeaders,
      ...replyToPath.headers,
    });
    response.end(
      replyToPath.rawBody ?? (replyToPath.body === undefined ? "" : JSON.stringify(replyToPath.body)),
    );
    if (refusalMilliseconds !== undefined) {
      server.close();
      setTimeout(() => server.listen(port, "127.0.0.1"), refusalMilliseconds);
    }
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
