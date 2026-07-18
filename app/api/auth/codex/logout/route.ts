import { NextResponse } from "next/server";
import { clearPkceCookie, clearSessionCookie } from "@/lib/codex-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  clearSessionCookie();
  clearPkceCookie();
  return NextResponse.json({ ok: true });
}
