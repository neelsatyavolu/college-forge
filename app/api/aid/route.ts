import { NextRequest } from "next/server";
import { emptyWorkspace, peekWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { aidPlan } from "@/lib/aid-plan";
import { aidEstimate } from "@/lib/aid-estimate";
import { aidChecklist } from "@/lib/aid-checklist";
import { AID_FIELD_WHY } from "@/lib/aid-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/aid: which aid forms each school on the Applications tab needs, and their aid deadlines, plus the
 * student's aid estimate (SAI, Pell, per-school net price; lib/aid-estimate.ts) and the FAFSA / CSS Profile steps.
 * Read-only, for the caller's own workspace only (never a workspace id from the query, never a share token).
 * Writes go through PATCH /api/workspace and the applications follow-up actions.
 */
export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  try {
    // Read only: a visitor without a stored workspace gets an empty checklist, and none is created.
    const ws = (await peekWorkspace(id)) ?? emptyWorkspace();
    const plan = aidPlan(ws);
    // details: the caller's own aid answers, so the Recs & aid page can edit them; why: one line per question.
    const data = { ...plan, estimate: aidEstimate(ws), checklist: aidChecklist(ws, plan), details: ws.aidProfile ?? {}, why: AID_FIELD_WHY };
    return Response.json({ success: true, data }, { headers });
  } catch (error) {
    console.error("aid plan failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ success: false, error: "Couldn't load the aid checklist. Try again." }, { status: 500, headers });
  }
}
