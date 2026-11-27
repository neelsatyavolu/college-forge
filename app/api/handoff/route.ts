import { NextRequest } from "next/server";
import { appOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A path on this origin, or the hub. Resolving first catches "/\t/evil.example" and "/\\evil.example", which browsers read as off-site. */
function safePath(p: string | null, origin: string): string {
  if (p && p.startsWith("/")) {
    try {
      const url = new URL(p, origin);
      // A pathname like "//evil.example" (from "/..//evil.example") would be read as another host when used again.
      if (url.origin === origin && !url.pathname.startsWith("//")) return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      // Not a URL: fall through to the hub.
    }
  }
  return "/hub/index.html";
}

/** Old forge.n3el.dev handoff links. The workspace no longer comes along, so this is a plain redirect. */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req);
  return new Response(null, { status: 302, headers: { location: new URL(safePath(req.nextUrl.searchParams.get("next"), origin), origin).toString() } });
}
