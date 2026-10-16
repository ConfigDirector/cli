import { cookies } from "next/headers";

export async function GET() {
  const store = await cookies();
  return Response.json({ theme: store.getValue("theme-preference", "light") });
}
