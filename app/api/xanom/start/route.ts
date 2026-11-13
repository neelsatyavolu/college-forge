import { NextRequest } from "next/server";
import { FLOW_COOKIE, FLOW_COOKIE_OPTIONS, startSignIn, type Intent } from "@/lib/xanom";
import { appOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts "Continue with Xanom". `return` must be a same-site path; the helper enforces it. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const intent: Intent = q.get("intent") === "link" ? "link" : "signin";
  try {
    const { url, cookie } = await startSignIn({
      redirectUri: `${appOrigin(req)}/api/xanom/callback`,
      intent,
      returnTo: q.get("return") ?? "/hub/index.html",
      prompt: q.get("prompt") === "login" ? "login" : undefined,
    });
    const headers = new Headers({ location: url, "cache-control": "no-store" });
    const o = FLOW_COOKIE_OPTIONS;
    headers.append("set-cookie", `${FLOW_COOKIE}=${cookie}; Path=${o.path}; Max-Age=${o.maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error("xanom start failed", err instanceof Error ? err.message : "unknown");
    return Response.redirect(new URL("/hub/index.html?signin_error=unavailable", appOrigin(req)), 302);
  }
}
