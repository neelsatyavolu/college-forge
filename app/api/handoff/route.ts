import { NextRequest } from "next/server";
import { readHandoff } from "@/lib/session";
import { appOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safePath = (p: string | null) => (p && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : "/hub/");

/** Arrives from forge.n3el.dev with that browser's workspace, so the first Xanom sign-in can keep it. */
export async function GET(req: NextRequest) {
  const ws = readHandoff(req.nextUrl.searchParams.get("t") ?? "");
  const headers = new Headers({ location: new URL(safePath(req.nextUrl.searchParams.get("next")), appOrigin(req)).toString() });
  if (ws && !req.cookies.get("cf_workspace")) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    headers.append("set-cookie", `cf_workspace=${ws}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
  }
  return new Response(null, { status: 302, headers });
}
