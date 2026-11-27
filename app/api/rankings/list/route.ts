import { NextRequest } from "next/server";
import careerData from "@/public/data/career-ranking.json";
import officialData from "@/public/data/official-rankings.json";
import type { CareerData } from "@/lib/career-ranking";
import { pathRanks } from "@/lib/career-settings";
import { buildRankListView } from "@/lib/rank-list-view";
import { readOwnApps, readRankingsMe } from "@/lib/rankings-me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: the List tab for the iOS app. The visitor's own applications ordered by the weighted average the web
 * List tab uses, with their saved career ranking (My path) in it. Read only.
 */
export async function GET(req: NextRequest) {
  const headers = { "cache-control": "no-store" };
  try {
    const [apps, me] = await Promise.all([readOwnApps(req), readRankingsMe(req)]);
    const career = apps.length ? pathRanks(careerData as unknown as CareerData, me) : null;
    return Response.json(buildRankListView(apps, careerData as unknown as { schools: Record<string, unknown>[] }, officialData, career), { headers });
  } catch (err) {
    console.error("rank list failed", err instanceof Error ? err.message : "unknown");
    return Response.json({ error: "Couldn’t load the list." }, { status: 500, headers });
  }
}
