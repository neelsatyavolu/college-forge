import { NextResponse } from "next/server";
import { clearPkceCookie, clearSessionCookie } from "@/lib/codex-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearSessionCookie();
  await clearPkceCookie();
  return NextResponse.json({ ok: true });
}
