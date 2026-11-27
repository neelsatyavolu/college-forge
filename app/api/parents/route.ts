import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace } from "@/lib/store";
import { allow } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/origin";
import { sendEmail } from "@/lib/email";
import { PARENT_LEVEL_INFO } from "@/lib/parent-view";
import { ParentError, cleanEmail, inviteParent, isFollowerRole, isParentLevel, listParents, removeParent, setParentLevel, type FollowerLevel, type FollowerRole, type ParentLevel } from "@/lib/parents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The student's parents and counselors: GET the list; POST {action:"invite", email, level, role?},
 * {action:"set-level", id, level} or {action:"remove", id}. `role` is "parent" (the default), "counselor" or
 * "coach"; a counselor starts at full unless a level is given, and a writing coach always sees essays only
 * (any level is ignored). Signed-in students only, on the web and in the iPhone
 * app (same session).
 */

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status = 400) => json({ success: false, error }, status);

const inviteUrl =(origin: string, token: string) => `${origin}/parent/accept?t=${encodeURIComponent(token)}`;

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Sign in to invite parents or counselors.", 401);
  return json({ success: true, data: await listParents(session.workspaceId) });
}

/** A sibling *.xanom.co page is same-site for the cookie, so writes also check Origin and need a JSON body. */
function crossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return true;
  return !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Sign in to invite parents or counselors.", 401);
  if (crossSite(req)) return fail("Not allowed.", 403);
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("A JSON object is required.");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON");
  }
  const ws = session.workspaceId;
  const id = typeof body.id === "string" ? body.id : "";
  try {
    if (body.action === "invite") {
      const role: FollowerRole = isFollowerRole(body.role) ? body.role : "parent";
      const who = role === "coach" ? "writing coach" : role;
      const email = cleanEmail(body.email);
      if (!email) return fail(`Enter your ${who}'s email address.`);
      if (email === session.email.toLowerCase()) return fail(`That's your own email. Enter your ${who}'s.`);
      if (body.role !== undefined && !isFollowerRole(body.role)) return fail("Choose parent, counselor or coach.");
      if (role !== "coach" && body.level !== undefined && !isParentLevel(body.level)) return fail("Choose basic, standard or full.");
      const level: ParentLevel = isParentLevel(body.level) ? body.level : role === "counselor" ? "full" : "basic";
      if (!(await allow(`parent-invite:${session.sub}`, 10, 60 * 60 * 1000))) return fail("Too many invites. Try again in an hour.", 429);
      const { token, link } = await inviteParent(ws, { email, level, role });
      const url = inviteUrl(appOrigin(req), token);
      const emailed = await sendInvite(email, url, await studentName(ws, session.name), link.level, role);
      return json({ success: true, url, emailed, data: await listParents(ws) });
    }
    if (body.action === "set-level") {
      if (!isParentLevel(body.level)) return fail("Choose basic, standard or full.");
      return json({ success: true, data: await setParentLevel(ws, id, body.level) });
    }
    if (body.action === "remove") {
      return json({ success: true, data: await removeParent(ws, id) });
    }
    return fail("Unknown action.");
  } catch (err) {
    if (err instanceof ParentError) return fail(err.message);
    console.error("api/parents failed", err instanceof Error ? err.name : "unknown");
    return fail("That didn't save. Try again.", 500);
  }
}

async function studentName(workspaceId: string, accountName: string): Promise<string> {
  const ws = await getWorkspace(workspaceId).catch(() => null);
  return ((ws?.applicant.name || accountName || "").trim().split(/\s+/)[0] || "Your student").slice(0, 60);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email is a convenience: the student also gets the link to send themselves, so a failure isn't an error. */
async function sendInvite(to: string, url: string, name: string, level: FollowerLevel, role: FollowerRole): Promise<boolean> {
  const sees = PARENT_LEVEL_INFO[level].forParent;
  const counselor = role === "counselor";
  const coach = role === "coach";
  const invited = counselor ? `${name} invited you to be their college counselor on Forge`
    : coach ? `${name} invited you to be their essay writing coach on Forge`
    : `${name} invited you to follow their college applications on Forge`;
  const notes = counselor ? " You can also leave them notes, on an essay or in general." : "";
  // The iPhone app doesn't show a coach's essays view yet.
  const where = coach ? "on the web" : "on the web or in the iPhone app";
  try {
    await sendEmail(to, {
      subject: invited,
      text: `${invited}.\n\nYou'll see ${sees}.${notes}\n\nAccept the invite (it works for 14 days):\n${url}\n\nYou'll sign in or create a free account. After that, open Forge ${where} with the same account.`,
      html: `<p>${esc(invited)}.</p><p>You'll see ${esc(sees)}.${esc(notes)}</p><p><a href="${esc(url)}">Accept the invite</a> (it works for 14 days).</p><p>You'll sign in or create a free account. After that, open Forge ${esc(where)} with the same account.</p>`,
    });
    return true;
  } catch (err) {
    console.error("parent invite email failed", err instanceof Error ? err.message.slice(0, 80) : "unknown");
    return false;
  }
}
