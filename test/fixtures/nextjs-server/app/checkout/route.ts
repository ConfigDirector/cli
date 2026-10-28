import { getConfigClient } from "@configdirector/nextjs-sdk/server";

export async function GET() {
  const evaluation = getConfigClient().evaluate("new-checkout", false, { id: "user-id" });
  return Response.json({ newCheckout: evaluation.value, reason: evaluation.reason });
}
