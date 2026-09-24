import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/codex-oauth";
import { clearPkceCookie, readPkceCookie, writeSessionCookie } from "@/lib/codex-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractCodeAndState(input: string): { code: string | null; state: string | null } {
  const trimmed = input.trim();
  try {
    if (trimmed.includes("://")) {
      const url = new URL(trimmed);
      return {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
      };
    }
    if (trimmed.includes("=")) {
      const params = new URLSearchParams(trimmed.replace(/^\?/, ""));
      return { code: params.get("code"), state: params.get("state") };
    }
  } catch {
    return { code: null, state: null };
  }
  return { code: null, state: null };
}

export async function POST(req: NextRequest) {
  let body: { callback?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const callback = typeof body.callback === "string" ? body.callback : "";
  if (!callback) {
    return NextResponse.json({ error: "Missing callback URL." }, { status: 400 });
  }

  const { code, state } = extractCodeAndState(callback);
  if (!code) {
    return NextResponse.json(
      { error: "Could not find authorization code in the URL." },
      { status: 400 }
    );
  }

  const pkce = await readPkceCookie();
  if (!pkce) {
    return NextResponse.json(
      { error: "OAuth session expired. Click Connect ChatGPT again." },
      { status: 400 }
    );
  }
  if (pkce.state !== state) {
    return NextResponse.json({ error: "OAuth state mismatch." }, { status: 400 });
  }

  try {
    const tokens = await exchangeCode(code, pkce.verifier);
    await writeSessionCookie(tokens);
    await clearPkceCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
