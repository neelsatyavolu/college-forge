import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace } from "@/lib/store";
import { studentsOf } from "@/lib/parents";
import { PARENT_LEVEL_INFO } from "@/lib/parent-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the students this signed-in parent follows. `id` is the parent link id used by /api/parent/[id]. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return Response.json({ success: false, error: "Please sign in again." }, { status: 401 });
  try {
    const students = await Promise.all(
      (await studentsOf(session.sub)).map(async (s) => {
        const ws = await getWorkspace(s.workspaceId);
        return {
          id: s.linkId,
          name: (ws.applicant.name || "").trim() || "Your student",
          cycle: ws.applicant.cycle || "",
          level: s.level,
          levelLabel: PARENT_LEVEL_INFO[s.level].label,
          applications: ws.tracker.apps.length,
        };
      }),
    );
    return Response.json({ success: true, data: { students } }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("api/parent failed", err instanceof Error ? err.name : "unknown");
    return Response.json({ success: false, error: "Couldn't load your students. Try again." }, { status: 500 });
  }
}
