import { createHash, timingSafeEqual } from "node:crypto";
import { deleteDoc, listDocs, readDoc } from "@/lib/doc-store";
import { getWorkspace } from "@/lib/store";
import { runChecks } from "@/lib/portal-check";

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
 * Hourly (pinged by the College Apps Worker's cron, and by Vercel cron as a daily fallback): checks every
 * portal whose last check is over 12 hours old, for workspaces with automatic checks on.
 */
async function sweep(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  const keys = await listDocs("autocheck/");
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
      const done = await runChecks(entry.workspaceId, { onlyDue: true, concurrency: 4 });
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
