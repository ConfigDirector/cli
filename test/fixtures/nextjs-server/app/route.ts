import { getConfigClient } from "@configdirector/nextjs-sdk/server";

export async function GET() {
  const client = getConfigClient();
  const value = client.getValue("my-config-key", false);
  return Response.json({ "my-config-key": value });
}
