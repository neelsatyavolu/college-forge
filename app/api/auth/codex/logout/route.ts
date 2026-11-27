import { NextResponse, type NextRequest } from "next/server";
import { clearVault } from "@/lib/token-vault";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { updateWorkspace } from "@/lib/store";
import { stopRun } from "@/lib/research-runner";
import { clearPkceCookie, clearSessionCookie } from "@/lib/codex-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Signing out also deletes the copy kept for background research (lib/token-vault.ts).
  const { id, setCookie } = await getWorkspaceId(req);
  if (!setCookie) {
    await clearVault(id);
    await updateWorkspace(id, (w) => stopRun(w, null, "You signed out of the AI, so research paused. Reconnect and press Try again.")).catch(() => undefined);
  }
  await clearSessionCookie();
  await clearPkceCookie();
  return NextResponse.json({ ok: true });
}
