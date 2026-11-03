type ConnectionFailure = "never-opened" | "dropped" | "not-transient";

type RetryDecision = { decision: "retry"; waitMilliseconds: number } | { decision: "give-up" };

const millisecondsBeforeEachRetry = [500, 1_000];

const repeatableMethods: ReadonlySet<string> = new Set(["GET", "PUT", "DELETE"]);

const retriesAfter: { [Failure in ConnectionFailure]: (method: string) => boolean } = {
  "never-opened": () => true,
  dropped: (method) => repeatableMethods.has(method),
  "not-transient": () => false,
};

const neverOpenedCodes: ReadonlySet<string> = new Set(["UND_ERR_CONNECT_TIMEOUT", "EAI_AGAIN"]);

const droppedCodes: ReadonlySet<string> = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);

const connectionFailureOf = (failure: unknown): ConnectionFailure => {
  const cause = failure instanceof Error ? failure.cause : undefined;
  if (cause instanceof AggregateError) {
    return "never-opened";
  }
  if (!(cause instanceof Error)) {
    return "not-transient";
  }
  const { code = "", syscall } = cause as NodeJS.ErrnoException;
  if (syscall === "connect" || neverOpenedCodes.has(code)) {
    return "never-opened";
  }
  return droppedCodes.has(code) ? "dropped" : "not-transient";
};

export const retryDecisionAfter = (method: string, failure: unknown, attemptsMade: number): RetryDecision => {
  const waitMilliseconds = millisecondsBeforeEachRetry[attemptsMade - 1];
  return waitMilliseconds !== undefined && retriesAfter[connectionFailureOf(failure)](method)
    ? { decision: "retry", waitMilliseconds }
    : { decision: "give-up" };
};
