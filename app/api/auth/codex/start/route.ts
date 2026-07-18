import { NextResponse } from "next/server";
import { buildAuthorizeUrl, generatePkce } from "@/lib/codex-oauth";
import { writePkceCookie } from "@/lib/codex-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { verifier, challenge, state } = generatePkce();
  writePkceCookie({ verifier, state });
  const authorizeUrl = buildAuthorizeUrl(challenge, state);
  return NextResponse.json({ authorizeUrl, state });
}
