import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = getSession(req);
  return Response.json(
    { signedIn: !!s, user: s ? { email: s.email, name: s.name } : null },
    { headers: { "cache-control": "no-store" } },
  );
}
