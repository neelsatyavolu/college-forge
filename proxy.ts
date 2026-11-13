import { NextResponse, type NextRequest } from "next/server";
import { signHandoff } from "@/lib/session";

/** Forge moved from forge.n3el.dev to forge.xanom.co. Old links keep working and keep the browser's workspace. */
const OLD_HOSTS = new Set(["forge.n3el.dev"]);
const NEW_ORIGIN = "https://forge.xanom.co";

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!OLD_HOSTS.has(host)) return NextResponse.next();
  const path = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  const ws = req.cookies.get("cf_workspace")?.value;
  if (req.method === "GET" && ws && /^[a-zA-Z0-9_-]{8,64}$/.test(ws) && process.env.SESSION_SECRET) {
    const url = new URL("/api/handoff", NEW_ORIGIN);
    url.searchParams.set("t", signHandoff(ws));
    url.searchParams.set("next", path.startsWith("/api/") ? "/hub/" : path);
    return NextResponse.redirect(url, 302);
  }
  return NextResponse.redirect(new URL(path, NEW_ORIGIN), 308);
}

export const config = { matcher: "/:path*" };
