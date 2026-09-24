import { NextResponse } from "next/server";
import { clearGrokPkceCookie, clearGrokSessionCookie } from "@/lib/grok-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearGrokPkceCookie();
  await clearGrokSessionCookie();
  return NextResponse.json({ ok: true });
}
