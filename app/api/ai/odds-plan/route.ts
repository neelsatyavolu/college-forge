import { NextRequest } from "next/server";
import { getWorkspace, updateWorkspace } from "@/lib/store";
import { oddsPlan, openTargets } from "@/lib/odds-plan";
import { oddsTargets } from "@/lib/admission-odds";
import { lookupStats, type SchoolStats } from "@/lib/school-stats";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOKUP_CONCURRENCY = 5;

/** The chat requests "Estimate my chances" runs (see lib/odds-plan.ts), after filling in Scorecard numbers for tracked schools. */
export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  if (setCookie) {
    return Response.json({ error: "Open your hub first so there is a workspace to estimate." }, { status: 400 });
  }
  let ws = await getWorkspace(id);
  if (!oddsTargets(ws).length) {
    return Response.json({ error: "Add schools to your shortlist or Progress first." }, { status: 400 });
  }
  const missing = openTargets(ws).flatMap((t) => (t.app && t.key.startsWith("app:") && !ws.schoolStats?.[t.app.id]?.admit ? [t.app] : []));
  if (missing.length) {
    const now = new Date().toISOString();
    const found: Record<string, SchoolStats> = {};
    for (let i = 0; i < missing.length; i += LOOKUP_CONCURRENCY) {
      const batch = missing.slice(i, i + LOOKUP_CONCURRENCY);
      const stats = await Promise.all(batch.map((app) => lookupStats(app, now)));
      batch.forEach((app, j) => { if (stats[j]) found[app.id] = stats[j]!; });
    }
    if (Object.keys(found).length) ws = await updateWorkspace(id, (w) => ({ ...w, schoolStats: { ...(w.schoolStats || {}), ...found } }));
  }
  const plan = oddsPlan(ws);
  return Response.json(plan, { headers: { "cache-control": "no-store" } });
}
