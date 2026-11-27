import type { NextRequest } from "next/server";

/**
 * Origin only: no Origin (the iPhone app, same-origin GETs) or this site's own. For writes a cross-site page can
 * send without a preflight whatever the check on the body, like a multipart upload or a DELETE with no body.
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin || origin === process.env.FORGE_ORIGIN;
}

/**
 * A sibling *.xanom.co page is same-site for the cookie, so a write also checks Origin and needs a JSON body
 * (a cross-site form can't send one without a preflight).
 */
export function sameSite(req: NextRequest): boolean {
  if (!sameOrigin(req)) return false;
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}
