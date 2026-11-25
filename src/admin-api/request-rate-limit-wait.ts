import * as v from "valibot";

const RequestRateLimitReachedBodySchema = v.object({
  error: v.string(),
  code: v.literal("REQUEST_RATE_LIMIT_REACHED"),
});

const RetryAfterSecondsSchema = v.pipe(v.string(), v.digits(), v.toNumber(), v.minValue(1), v.maxValue(60));

type WaitDecision =
  | { decision: "use-answer" }
  | { decision: "wait-and-retry"; waitSeconds: number }
  | { decision: "give-up-without-waiting"; apiMessage: string }
  | { decision: "give-up-after-waits"; apiMessage: string };

const mostWaitsPerRequest = 3;

export const waitDecisionAfter = (response: Response, body: unknown, waitsMade: number): WaitDecision => {
  if (response.status !== 429 || !v.is(RequestRateLimitReachedBodySchema, body)) {
    return { decision: "use-answer" };
  }
  if (waitsMade === mostWaitsPerRequest) {
    return { decision: "give-up-after-waits", apiMessage: body.error };
  }
  const retryAfterSeconds = v.safeParse(RetryAfterSecondsSchema, response.headers.get("retry-after"));
  return retryAfterSeconds.success
    ? { decision: "wait-and-retry", waitSeconds: retryAfterSeconds.output }
    : { decision: "give-up-without-waiting", apiMessage: body.error };
};
