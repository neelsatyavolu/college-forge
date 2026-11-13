import { NextRequest } from "next/server";
import { FLOW_COOKIE, finishSignIn, XanomError } from "@/lib/xanom";
import { signInAccount, signSession, sessionCookie } from "@/lib/session";
import { anonymousWorkspaceId } from "@/lib/workspace-cookie";
import { appOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clearFlow = () => `${FLOW_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

function redirect(to: URL, cookies: string[]): Response {
  const headers = new Headers({ location: to.toString(), "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

/**
 * Xanom sends the student back here. Linking rules (SPEC §2): a Forge account is the Xanom account itself, so
 * rule 1 (match by sub) covers everyone; a first sign-in creates the account and adopts this browser's
 * anonymous workspace when nobody else owns it.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req);
  try {
    const { user, returnTo } = await finishSignIn(req.nextUrl.searchParams, req.cookies.get(FLOW_COOKIE)?.value);
    const account = await signInAccount(user, anonymousWorkspaceId(req));
    const session = signSession({ sub: account.sub, workspaceId: account.workspaceId, email: account.email, name: account.name });
    // The anonymous workspace moved to the account; this browser no longer needs (or should send) the old id.
    const clearAnon = `cf_workspace=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    return redirect(new URL(returnTo, origin), [clearFlow(), sessionCookie(session), clearAnon]);
  } catch (err) {
    const code = err instanceof XanomError ? err.code : "failed";
    if (!(err instanceof XanomError)) console.error("xanom callback failed", err instanceof Error ? err.message : "unknown");
    return redirect(new URL(`/hub/index.html?signin_error=${encodeURIComponent(code.slice(0, 40))}`, origin), [clearFlow()]);
  }
}
