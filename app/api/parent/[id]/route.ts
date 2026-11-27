import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace, updateWorkspace, type Workspace } from "@/lib/store";
import { allow } from "@/lib/rate-limit";
import { parentAccess, type Access } from "@/lib/parents";
import { PARENT_LEVEL_INFO, followerView } from "@/lib/parent-view";
import { applyWorkspacePatch } from "@/lib/workspace-patch";
import { isEssayHidden } from "@/lib/essay-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status = 400) => json({ success: false, error }, status);
const GONE = "You don't have access to this student anymore.";
const MAX_NOTE = 4000;
/** Same as lib/essay-tools.ts: essay ids can carry periods and colons. */
const ESSAY_ID = /^[\w.:-]{1,200}$/;

function payload(ws: Workspace, access: Access, id: string) {
  const info = PARENT_LEVEL_INFO[access.level];
  return { ...followerView(ws, access), id, levelLabel: info.label, levelSummary: info.forParent };
}

/** GET: one student's dashboard, cut to the level the student chose for this parent or counselor (a coach: essays only). */
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

// Only essays the student hasn't hidden (nor for a school they turned off) can take a comment: those aren't in any follower's view.
const essayIds = (ws: Workspace) =>
  new Set([
    ...ws.essays.commonApp.filter((e) => !isEssayHidden(ws, e, "common")),
    ...Object.entries(ws.essays.supplements).flatMap(([key, list]) => (list || []).filter((e) => !isEssayHidden(ws, e, key))),
  ].map((e) => e.id));

class AccessEnded extends Error {}
class NoEssay extends Error {}

/** Re-read inside each write: a follower removed or lowered meanwhile writes nothing and sees only what they may now. */
async function stillRole(sub: string, linkId: string, workspaceId: string, role: "counselor" | "coach"): Promise<Access> {
  const now = await parentAccess(sub, linkId);
  if (!now || now.role !== role || now.workspaceId !== workspaceId) throw new AccessEnded();
  return now;
}

/**
 * Counselors and writing coaches: POST {action:"note", body, essayId?} leaves a note the student sees in their
 * hub (on that essay when the counselor can see essays; a coach must name an essay);
 * {action:"delete-note", noteId} removes one this follower wrote. The author is the follower's account name,
 * never the request body. Neither can change drafts or anything else.
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
    const role = access.role;
    if (role === "parent") return fail("Parents can read the dashboard but not leave notes.", 403);
    const coach = role === "coach";
    const fallback = coach ? "Coach" : "Counselor";
    const author = (access.name || session.name || fallback).trim().slice(0, 80) || fallback;

    if (body.action === "note") {
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text || text.length > MAX_NOTE) return fail(`A ${coach ? "comment" : "note"} is 1–${MAX_NOTE} characters.`);
      const wanted = typeof body.essayId === "string" && ESSAY_ID.test(body.essayId) ? body.essayId : undefined;
      if (coach && !wanted) return fail("Choose an essay to comment on.");
      if (!(await allow(`${role}-note:${session.sub}`, 60, 60 * 60 * 1000))) return fail(`Too many ${coach ? "comments" : "notes"}. Try again in an hour.`, 429);
      let current = access;
      const next = await updateWorkspace(access.workspaceId, async (ws) => {
        current = await stillRole(session.sub, id, access.workspaceId, role);
        if (coach) {
          if (!wanted || !essayIds(ws).has(wanted)) throw new NoEssay();
          return applyWorkspacePatch(ws, { advisorNote: { body: text, author, essayId: wanted, via: "coach", byLink: id } });
        }
        const level = current.level === "essays" ? "basic" : current.level;
        const essayId = level === "full" && wanted && essayIds(ws).has(wanted) ? wanted : undefined;
        return applyWorkspacePatch(ws, { advisorNote: { body: text, author, essayId, via: "counselor", byLink: id, authorLevel: level } });
      });
      return json({ success: true, data: payload(next, current, id) });
    }

    if (body.action === "delete-note") {
      const noteId = typeof body.noteId === "string" ? body.noteId : "";
      let current = access;
      const next = await updateWorkspace(access.workspaceId, async (ws) => {
        current = await stillRole(session.sub, id, access.workspaceId, role);
        const note = ws.advisorNotes.find((n) => n.id === noteId);
        if (!note || note.via !== role || note.byLink !== id) return ws;
        return applyWorkspacePatch(ws, { removeAdvisorNoteId: noteId });
      });
      return json({ success: true, data: payload(next, current, id) });
    }

    return fail("Unknown action.");
  } catch (err) {
    if (err instanceof AccessEnded) return fail(GONE, 404);
    if (err instanceof NoEssay) return fail("That essay isn't there anymore.", 404);
    console.error("api/parent/[id] POST failed", err instanceof Error ? err.name : "unknown");
    return fail("That didn't save. Try again.", 500);
  }
}
