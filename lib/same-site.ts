import type { NextRequest } from "next/server";

/**
 * A sibling *.xanom.co page is same-site for the cookie, so a write also checks Origin and needs a JSON body
 * (a cross-site form can't send one without a preflight).
 */
export function sameSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return false;
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}
