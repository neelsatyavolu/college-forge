import type { NextRequest } from "next/server";
import { verifyAccess } from "@/lib/oauth";
import { readLogins, readMaster, resolveLogin } from "@/lib/portal-logins";
import { loginHost, masterAllowed } from "@/lib/portal-check";
import { allow } from "@/lib/rate-limit";
import { getWorkspace } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Saved portal logins for the collegeforge command-line tool (`creds`, `1password`). Only a token whose
 * grant has the "logins" scope gets them, and that scope is only granted to loopback redirects.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAccess(req.headers.get("authorization"));
  if (!auth) return json({ error: "Sign in with collegeforge login first." }, 401);
  if (!auth.logins) return json({ error: "This sign-in can't read saved passwords. Run collegeforge login again." }, 403);
  if (!(await allow(`cli-logins:${auth.grantId}`, 30, 60 * 1000))) return json({ error: "Too many requests. Wait a minute." }, 429);
  try {
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const [ws, logins, master] = await Promise.all([getWorkspace(auth.workspaceId), readLogins(auth.workspaceId), readMaster(auth.workspaceId)]);
    const out: Record<string, { username: string; password: string; portalUrl: string }> = {};
    for (const app of ws.tracker.apps) {
      // A school using the master login gets it here too, under the same host rules as checks.
      const resolved = resolveLogin(app.id, loginHost(app), logins, masterAllowed(app) ? master : null, { allowFailed: true });
      if (!resolved || (ids.length && !ids.includes(app.id))) continue;
      const { login, source } = resolved;
      // The master's website is the host it was pinned to, never an edited link.
      const portalUrl = source === "master" && login.host ? `https://${login.host}/` : app.portalUrl;
      out[app.id] = { username: login.username, password: login.password, portalUrl };
    }
    return json({ logins: out });
  } catch (err) {
    console.error("cli logins failed", err instanceof Error ? err.name : "unknown");
    return json({ error: "Something went wrong on Forge's side." }, 500);
  }
}
