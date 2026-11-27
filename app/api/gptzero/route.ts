import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { allow } from "@/lib/rate-limit";
import { cleanEmail } from "@/lib/parents";
import { GptzeroError, signIn } from "@/lib/gptzero";
import { deleteGptzero, readGptzero, saveGptzero } from "@/lib/gptzero-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The student's GPTZero account. GET {connected, email (partly hidden)}; POST {action:"connect", email,
 * password} checks the login with GPTZero and saves it only if GPTZero accepts it; {action:"disconnect"}.
 * The password never comes back out.
 */

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status = 400) => json({ success: false, error }, status);

function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, user.length - 1)))}@${domain}`;
}

/** A sibling *.xanom.co page is same-site for the cookie, so writes also check Origin and need a JSON body. */
function crossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return true;
  return !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Sign in to connect GPTZero.", 401);
  try {
    const login = await readGptzero(session.workspaceId);
    return json({ success: true, data: login ? { connected: true, email: maskEmail(login.email) } : { connected: false } });
  } catch (err) {
    console.error("api/gptzero GET failed", err instanceof Error ? err.name : "unknown");
    return fail("Couldn't read your GPTZero connection. Try again.", 500);
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Sign in to connect GPTZero.", 401);
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
  try {
    if (body.action === "disconnect") {
      await deleteGptzero(ws);
      return json({ success: true, data: { connected: false } });
    }
    if (body.action === "connect") {
      const email = cleanEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      if (!email) return fail("Enter the email you use for GPTZero.");
      if (!password || password.length > 256) return fail("Enter your GPTZero password.");
      if (!(await allow(`gptzero-connect:${session.sub}`, 5, 60 * 60 * 1000))) return fail("Too many tries. Try again in an hour.", 429);
      let s;
      try {
        s = await signIn(email, password);
      } catch (err) {
        if (err instanceof GptzeroError && err.kind === "login") {
          return fail("GPTZero didn't accept that email and password. If you sign in to GPTZero with Google, set a password there first.");
        }
        if (err instanceof GptzeroError) return fail("GPTZero isn't answering right now. Try again later.", 502);
        throw err;
      }
      await saveGptzero(ws, { email, password, token: s.token, tokenExp: s.expiresAt });
      return json({ success: true, data: { connected: true, email: maskEmail(email) } });
    }
    return fail("Unknown action.");
  } catch (err) {
    console.error("api/gptzero POST failed", err instanceof Error ? err.name : "unknown");
    return fail("That didn't save. Try again.", 500);
  }
}
