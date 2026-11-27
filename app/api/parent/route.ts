import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace } from "@/lib/store";
import { studentsOf } from "@/lib/parents";
import { PARENT_LEVEL_INFO, parentView } from "@/lib/parent-view";
import { followerSummary } from "@/lib/follower-summary";
import { todayIso } from "@/lib/tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: the students this signed-in parent or counselor follows, each with a roster summary (next deadline,
 * what's due or overdue, open flags) cut to the level that student shares. `id` is the link id used by
 * /api/parent/[id].
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return Response.json({ success: false, error: "Please sign in again." }, { status: 401 });
  try {
    const today = todayIso();
    const students = await Promise.all(
      (await studentsOf(session.sub)).map(async (s) => {
        const ws = await getWorkspace(s.workspaceId);
        return {
          id: s.linkId,
          name: (ws.applicant.name || "").trim() || "Your student",
          cycle: ws.applicant.cycle || "",
          role: s.role,
          level: s.level,
          levelLabel: PARENT_LEVEL_INFO[s.level].label,
          applications: ws.tracker.apps.length,
          summary: followerSummary(parentView(ws, s.level, today), today),
        };
      }),
    );
    return Response.json({ success: true, data: { students } }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("api/parent failed", err instanceof Error ? err.name : "unknown");
    return Response.json({ success: false, error: "Couldn't load your students. Try again." }, { status: 500 });
  }
}
