import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace } from "@/lib/store";
import { parentAccess } from "@/lib/parents";
import { PARENT_LEVEL_INFO, parentView } from "@/lib/parent-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET: one student's dashboard, cut to the level the student chose for this parent. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const session = getSession(req);
  if (!session) return Response.json({ success: false, error: "Please sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const access = await parentAccess(session.sub, id);
    if (!access) return Response.json({ success: false, error: "You don't have access to this student anymore." }, { status: 404 });
    const view = parentView(await getWorkspace(access.workspaceId), access.level);
    return Response.json(
      { success: true, data: { ...view, id, levelLabel: PARENT_LEVEL_INFO[access.level].label, levelSummary: PARENT_LEVEL_INFO[access.level].forParent } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("api/parent/[id] failed", err instanceof Error ? err.name : "unknown");
    return Response.json({ success: false, error: "Couldn't load this dashboard. Try again." }, { status: 500 });
  }
}
