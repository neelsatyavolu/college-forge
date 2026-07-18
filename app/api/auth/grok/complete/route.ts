import { NextRequest, NextResponse } from "next/server";
import { exchangeGrokCode, extractGrokCodeAndState } from "@/lib/grok-oauth";
import {
  clearGrokPkceCookie,
  readGrokPkceCookie,
  writeGrokSessionCookie,
} from "@/lib/grok-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { callback?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const callback = typeof body.callback === "string" ? body.callback : "";
  if (!callback) {
    return NextResponse.json(
      { error: "Missing callback URL or authorization code." },
      { status: 400 }
    );
  }

  const { code, state } = extractGrokCodeAndState(callback);
  if (!code) {
    return NextResponse.json(
      { error: "Could not find authorization code." },
      { status: 400 }
    );
  }

  const pkce = readGrokPkceCookie();
  if (!pkce) {
    return NextResponse.json(
      { error: "OAuth session expired. Click Connect Grok again." },
      { status: 400 }
    );
  }
  if (state && pkce.state !== state) {
    return NextResponse.json({ error: "OAuth state mismatch." }, { status: 400 });
  }

  try {
    const tokens = await exchangeGrokCode(code, pkce.verifier);
    writeGrokSessionCookie(tokens);
    clearGrokPkceCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
