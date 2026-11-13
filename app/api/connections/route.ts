import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { listGrants, revokeGrant } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Assistants connected over MCP, for Settings, and "Disconnect". */
export async function GET(req: NextRequest) {
  const s = getSession(req);
  if (!s) return Response.json({ success: false, signedOut: true }, { status: 401 });
  const grants = await listGrants(s.sub);
  return Response.json(
    { success: true, data: grants.map((g) => ({ id: g.grantId, name: g.client_name, host: g.redirect_host, createdAt: g.created_at * 1000 })) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const s = getSession(req);
  if (!s) return Response.json({ success: false, signedOut: true }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return Response.json({ success: false }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string") return Response.json({ success: false, error: "id required" }, { status: 400 });
  await revokeGrant(s.sub, body.id);
  return Response.json({ success: true });
}
