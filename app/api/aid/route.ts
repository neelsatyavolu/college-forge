import { NextRequest } from "next/server";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { aidPlan } from "@/lib/aid-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/aid: which aid forms each school on the Applications tab needs, and their aid deadlines.
 * Read-only, for the caller's own workspace only (never a workspace id from the query, never a share token).
 * Writes go through PATCH /api/workspace and the applications follow-up actions.
 */
export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  try {
    const ws = await getWorkspace(id);
    return Response.json({ success: true, data: aidPlan(ws) }, { headers });
  } catch (error) {
    console.error("aid plan failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ success: false, error: "Couldn't load the aid checklist. Try again." }, { status: 500, headers });
  }
}
