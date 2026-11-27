import { NextRequest } from "next/server";
import data from "@/public/data/career-ranking.json";
import type { CareerData } from "@/lib/career-ranking";
import { readRankingsMe, saveRankingsSettings } from "@/lib/rankings-me";
import { sameSite } from "@/lib/same-site";
import { buildRankingsView, rankingsViewInput } from "@/lib/rankings-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4_000;

/**
 * POST {view, weights?, flags?, targets?, save?}: the career ranking computed on the server, for the iOS app.
 * Uses the visitor's own workspace the same way /api/rankings/me does. With save, the settings sent are
 * stored on that workspace first, so the website and the List tab rank the same way.
 */
export async function POST(req: NextRequest) {
  const headers = { "cache-control": "no-store" };
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return Response.json({ error: "Request too large." }, { status: 413, headers });
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
  const input = rankingsViewInput.safeParse(body);
  if (!input.success) return Response.json({ error: "Invalid ranking settings." }, { status: 400, headers });
  const { save, weights, flags, targets } = input.data;
  if (save && (weights || flags || targets?.length)) {
    if (!sameSite(req)) return Response.json({ error: "Not allowed." }, { status: 403, headers });
    try {
      await saveRankingsSettings(req, { ...(weights && { weights }), ...(flags && { flags }), ...(targets?.length && { targets }) });
    } catch (err) {
      console.error("rankings settings save failed", err instanceof Error ? err.message : "unknown");
    }
  }
  const me = await readRankingsMe(req);
  return Response.json(buildRankingsView(data as unknown as CareerData, me, input.data), { headers });
}
