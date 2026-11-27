import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace, updateWorkspace, type Workspace } from "@/lib/store";
import { allow } from "@/lib/rate-limit";
import { parentAccess, type Access } from "@/lib/parents";
import { PARENT_LEVEL_INFO, followerView } from "@/lib/parent-view";
import { applyWorkspacePatch } from "@/lib/workspace-patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status = 400) => json({ success: false, error }, status);
const GONE = "You don't have access to this student anymore.";
const MAX_NOTE = 4000;
const ESSAY_ID = /^[A-Za-z0-9_-]{1,80}$/;

function payload(ws: Workspace, access: Access, id: string) {
  const info = PARENT_LEVEL_INFO[access.level];
  return { ...followerView(ws, access), id, levelLabel: info.label, levelSummary: info.forParent };
}

/** GET: one student's dashboard, cut to the level the student chose for this parent or counselor. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const session = getSession(req);
  if (!session) return fail("Please sign in again.", 401);
  const { id } = await ctx.params;
  try {
    const access = await parentAccess(session.sub, id);
    if (!access) return fail(GONE, 404);
    return json({ success: true, data: payload(await getWorkspace(access.workspaceId), access, id) });
  } catch (err) {
    console.error("api/parent/[id] failed", err instanceof Error ? err.name : "unknown");
    return fail("Couldn't load this dashboard. Try again.", 500);
  }
}

/** A sibling *.xanom.co page is same-site for the cookie, so writes also check Origin and need a JSON body. */
function crossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return true;
  return !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

const essayIds = (ws: Workspace) => new Set([...ws.essays.commonApp, ...Object.values(ws.essays.supplements).flat()].map((e) => e.id));

class AccessEnded extends Error {}

/** Re-read inside each write: a counselor removed or lowered meanwhile writes nothing and sees only what they may now. */
async function stillCounselor(sub: string, linkId: string, workspaceId: string): Promise<Access> {
  const now = await parentAccess(sub, linkId);
  if (!now || now.role !== "counselor" || now.workspaceId !== workspaceId) throw new AccessEnded();
  return now;
}

/**
 * Counselors only: POST {action:"note", body, essayId?} leaves a note the student sees in their hub (on that
 * essay when the counselor can see essays); {action:"delete-note", noteId} removes one this counselor wrote.
 * The author is the counselor's account name, never the request body.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const session = getSession(req);
  if (!session) return fail("Please sign in again.", 401);
  if (crossSite(req)) return fail("Not allowed.", 403);
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("A JSON object is required.");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON");
  }
  try {
    const access = await parentAccess(session.sub, id);
    if (!access) return fail(GONE, 404);
    if (access.role !== "counselor") return fail("Parents can read the dashboard but not leave notes.", 403);
    const author = (access.name || session.name || "Counselor").trim().slice(0, 80) || "Counselor";

    if (body.action === "note") {
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text || text.length > MAX_NOTE) return fail(`A note is 1–${MAX_NOTE} characters.`);
      if (!(await allow(`counselor-note:${session.sub}`, 60, 60 * 60 * 1000))) return fail("Too many notes. Try again in an hour.", 429);
      const wanted = typeof body.essayId === "string" && ESSAY_ID.test(body.essayId) ? body.essayId : undefined;
      let current = access;
      const next = await updateWorkspace(access.workspaceId, async (ws) => {
        current = await stillCounselor(session.sub, id, access.workspaceId);
        const essayId = current.level === "full" && wanted && essayIds(ws).has(wanted) ? wanted : undefined;
        return applyWorkspacePatch(ws, { advisorNote: { body: text, author, essayId, via: "counselor", byLink: id, authorLevel: current.level } });
      });
      return json({ success: true, data: payload(next, current, id) });
    }

    if (body.action === "delete-note") {
      const noteId = typeof body.noteId === "string" ? body.noteId : "";
      let current = access;
      const next = await updateWorkspace(access.workspaceId, async (ws) => {
        current = await stillCounselor(session.sub, id, access.workspaceId);
        const note = ws.advisorNotes.find((n) => n.id === noteId);
        if (!note || note.via !== "counselor" || note.byLink !== id) return ws;
        return applyWorkspacePatch(ws, { removeAdvisorNoteId: noteId });
      });
      return json({ success: true, data: payload(next, current, id) });
    }

    return fail("Unknown action.");
  } catch (err) {
    if (err instanceof AccessEnded) return fail(GONE, 404);
    console.error("api/parent/[id] POST failed", err instanceof Error ? err.name : "unknown");
    return fail("That didn't save. Try again.", 500);
  }
}
