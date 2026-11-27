import { NextResponse, type NextRequest } from "next/server";
import { clearVault } from "@/lib/token-vault";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { clearGrokPkceCookie, clearGrokSessionCookie } from "@/lib/grok-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Signing out also deletes the copy kept for background research (lib/token-vault.ts).
  const { id, setCookie } = await getWorkspaceId(req);
  if (!setCookie) await clearVault(id);
  await clearGrokPkceCookie();
  await clearGrokSessionCookie();
  return NextResponse.json({ ok: true });
}
