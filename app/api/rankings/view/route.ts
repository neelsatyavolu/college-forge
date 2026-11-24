import { NextRequest } from "next/server";
import data from "@/public/data/career-ranking.json";
import type { CareerData } from "@/lib/career-ranking";
import { readRankingsMe } from "@/lib/rankings-me";
import { buildRankingsView, rankingsViewInput } from "@/lib/rankings-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4_000;

/**
 * POST {view, weights?, flags?, targets?}: the career ranking computed on the server, for the iOS app.
 * Uses the visitor's own workspace the same way /api/rankings/me does; read only.
 */
export async function POST(req: NextRequest) {
  const headers = { "cache-control": "no-store" };
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return Response.json({ error: "Request too large." }, { status: 413, headers });
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
  const input = rankingsViewInput.safeParse(body);
  if (!input.success) return Response.json({ error: "Invalid ranking settings." }, { status: 400, headers });
  const me = await readRankingsMe(req);
  return Response.json(buildRankingsView(data as unknown as CareerData, me, input.data), { headers });
}
