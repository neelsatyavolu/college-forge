import { NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/session";
import { appOrigin } from "@/lib/origin";

export const runtime = "nodejs";

/** Signs out of Forge only (the Xanom session stays, per the spec). Also drops the anonymous workspace cookie. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== appOrigin(req) && origin !== new URL(req.url).origin) {
    return Response.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", clearSessionCookie());
  headers.append("set-cookie", `cf_workspace=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return new Response(JSON.stringify({ success: true }), { headers });
}
