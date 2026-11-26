import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace } from "@/lib/store";
import { allow } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/origin";
import { sendEmail } from "@/lib/email";
import { PARENT_LEVEL_INFO } from "@/lib/parent-view";
import { ParentError, cleanEmail, inviteParent, isParentLevel, listParents, removeParent, setParentLevel, type ParentLevel } from "@/lib/parents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The student's parents: GET the list; POST {action:"invite", email, level}, {action:"set-level", id, level}
 * or {action:"remove", id}. Signed-in students only, on the web and in the iPhone app (same session).
 */

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status = 400) => json({ success: false, error }, status);

const inviteUrl =(origin: string, token: string) => `${origin}/parent/accept?t=${encodeURIComponent(token)}`;

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Sign in to invite parents.", 401);
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
  if (!session) return fail("Sign in to invite parents.", 401);
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
      const email = cleanEmail(body.email);
      if (!email) return fail("Enter your parent's email address.");
      if (email === session.email.toLowerCase()) return fail("That's your own email. Enter your parent's.");
      const level: ParentLevel = isParentLevel(body.level) ? body.level : "basic";
      if (!(await allow(`parent-invite:${session.sub}`, 10, 60 * 60 * 1000))) return fail("Too many invites. Try again in an hour.", 429);
      const { token } = await inviteParent(ws, { email, level });
      const url = inviteUrl(appOrigin(req), token);
      const emailed = await sendInvite(email, url, await studentName(ws, session.name), level);
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
async function sendInvite(to: string, url: string, name: string, level: ParentLevel): Promise<boolean> {
  const sees = PARENT_LEVEL_INFO[level].forParent;
  try {
    await sendEmail(to, {
      subject: `${name} invited you to follow their college applications on Forge`,
      text: `${name} invited you to follow their college applications on Forge.\n\nYou'll see ${sees}.\n\nAccept the invite (it works for 14 days):\n${url}\n\nYou'll sign in or create a free account. After that, open Forge on the web or in the iPhone app with the same account.`,
      html: `<p>${esc(name)} invited you to follow their college applications on Forge.</p><p>You'll see ${esc(sees)}.</p><p><a href="${esc(url)}">Accept the invite</a> (it works for 14 days).</p><p>You'll sign in or create a free account. After that, open Forge on the web or in the iPhone app with the same account.</p>`,
    });
    return true;
  } catch (err) {
    console.error("parent invite email failed", err instanceof Error ? err.message.slice(0, 80) : "unknown");
    return false;
  }
}
