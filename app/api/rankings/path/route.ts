import { NextRequest } from "next/server";
import data from "@/public/data/career-ranking.json";
import type { CareerData } from "@/lib/career-ranking";
import { pathRanks } from "@/lib/career-settings";
import { readRankingsMe } from "@/lib/rankings-me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: every school's My path rank on the full career list, with the visitor's saved majors, weights and
 * adjustments, for the List tab's average. Read only.
 */
export async function GET(req: NextRequest) {
  const me = await readRankingsMe(req);
  return Response.json({ ranks: pathRanks(data as unknown as CareerData, me) }, { headers: { "cache-control": "no-store" } });
}
