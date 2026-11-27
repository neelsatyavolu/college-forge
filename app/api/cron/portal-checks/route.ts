import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { deleteDoc, listDocs, readDoc } from "@/lib/doc-store";
import { getWorkspace } from "@/lib/store";
import { runChecks, slotOpen } from "@/lib/portal-check";
import { loadVault } from "@/lib/token-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 240_000;
const digest = (s: string) => createHash("sha256").update(s).digest();

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && timingSafeEqual(digest(given), digest(secret));
}

/**
 * Hourly (pinged by the College Apps Worker's cron, and by Vercel cron as a daily fallback): for workspaces
 * with automatic checks on, runs the current slot of each one's check schedule if it hasn't run yet
 * (lib/check-schedule.ts). Starts at a random point in the list, so when the time budget runs out it isn't
 * always the same workspaces that wait for the next hour.
 */
async function sweep(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  // Stored AI sign-ins for background research expire after a day; loading one past that deletes it.
  for (const key of await listDocs("ai-vault/").catch(() => [])) {
    await loadVault(key.slice("ai-vault/".length).replace(/\.json$/, "")).catch(() => null);
  }
  const listed = await listDocs("autocheck/");
  const from = listed.length ? randomInt(listed.length) : 0;
  const keys = [...listed.slice(from), ...listed.slice(0, from)];
  let workspaces = 0;
  let checked = 0;
  for (const key of keys) {
    if (Date.now() - started > BUDGET_MS) break;
    const entry = await readDoc<{ workspaceId: string }>(key).catch(() => null);
    if (!entry?.workspaceId) continue;
    try {
      const ws = await getWorkspace(entry.workspaceId);
      if (!ws.tracker.autocheck || !ws.tracker.apps.some((a) => a.login?.hasPassword)) {
        await deleteDoc(key); // stale index entry: checks were turned off or every login was removed
        continue;
      }
      if (!slotOpen(ws.tracker)) continue; // this slot already ran
      const done = await runChecks(entry.workspaceId, { onlyDue: true, concurrency: 4, notify: true });
      workspaces++;
      checked += done.length;
    } catch (err) {
      console.error("autocheck failed for a workspace", err instanceof Error ? err.name : "unknown");
    }
  }
  return Response.json({ workspaces, checked, ms: Date.now() - started });
}

export const POST = sweep;
export const GET = sweep;
