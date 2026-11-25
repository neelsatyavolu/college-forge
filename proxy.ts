import { NextResponse, type NextRequest } from "next/server";
import { APP_GRANT_HEADER, verifyAccess } from "@/lib/oauth";
import { SESSION_COOKIE, createHandoff, getAccount, readSession, signSession } from "@/lib/session";

/** Forge moved from forge.n3el.dev to forge.xanom.co. Old links keep working and keep the browser's workspace. */
const OLD_HOSTS = new Set(["forge.n3el.dev"]);
const NEW_ORIGIN = "https://forge.xanom.co";

/** Routes with their own bearer authentication (or none to borrow) that the iPhone app never calls. */
const APP_EXEMPT = /^\/api\/(cron|cli|service)(\/|$)|^\/api\/xanom\/summary\/?$/;

export async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (OLD_HOSTS.has(host)) return oldHost(req);
  const path = req.nextUrl.pathname;
  // Signed-in visitors skip the landing page and go straight to their workspace ("/?home" still shows it).
  if (path === "/" && req.method === "GET" && !req.nextUrl.searchParams.has("home") && readSession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.redirect(new URL("/hub/index.html", req.url), 307);
  }
  if (req.headers.get("x-forge-app") === "ios" && path.startsWith("/api/") && !APP_EXEMPT.test(path)) return appRequest(req);
  if (req.headers.has(APP_GRANT_HEADER)) {
    const headers = new Headers(req.headers);
    headers.delete(APP_GRANT_HEADER);
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}

async function oldHost(req: NextRequest) {
  const path = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  const ws = req.cookies.get("cf_workspace")?.value;
  if (req.method === "GET" && ws && /^[a-zA-Z0-9_-]{8,64}$/.test(ws)) {
    const url = new URL("/api/handoff", NEW_ORIGIN);
    url.searchParams.set("t", await createHandoff(ws));
    url.searchParams.set("next", path.startsWith("/api/") ? "/hub/index.html" : path);
    return NextResponse.redirect(url, 302);
  }
  return NextResponse.redirect(new URL(path, NEW_ORIGIN), 308);
}

const fail = (status: number, error: string) =>
  Response.json({ success: false, error }, { status, headers: { "cache-control": "no-store" } });

/**
 * The iPhone app signs in through Forge's OAuth server and sends its access token. Here it becomes an
 * ordinary signed session cookie on the forwarded request, so every /api route works unchanged.
 */
async function appRequest(req: NextRequest) {
  let session: string;
  let grantId: string;
  try {
    const auth = await verifyAccess(req.headers.get("authorization"));
    const account = auth ? await getAccount(auth.sub) : null;
    if (!auth || !account || account.workspaceId !== auth.workspaceId) return fail(401, "Please sign in again.");
    // Assistant and CLI tokens keep their narrower /mcp and /api/cli access; only the app's grant is a session.
    if (!auth.app) return fail(403, "This sign-in can't be used here.");
    grantId = auth.grantId;
    session = signSession({ sub: account.sub, workspaceId: account.workspaceId, email: account.email, name: account.name });
  } catch (err) {
    console.error("app sign-in check failed", err instanceof Error ? err.name : "unknown");
    return fail(503, "Forge couldn't check your sign-in. Try again.");
  }
  const headers = new Headers(req.headers);
  headers.delete("authorization");
  headers.set(APP_GRANT_HEADER, grantId);
  const kept = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !/^(forge_session|cf_workspace)=/.test(c));
  headers.set("cookie", [...kept, `${SESSION_COOKIE}=${session}`].join("; "));
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/:path*" };
