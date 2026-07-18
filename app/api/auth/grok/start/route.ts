import { NextResponse } from "next/server";
import { buildGrokAuthorizeUrl, generateGrokPkce } from "@/lib/grok-oauth";
import { writeGrokPkceCookie } from "@/lib/grok-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { verifier, challenge, state } = generateGrokPkce();
  writeGrokPkceCookie({ verifier, state });
  const authorizeUrl = buildGrokAuthorizeUrl(challenge, state);
  return NextResponse.json({ authorizeUrl, state });
}
