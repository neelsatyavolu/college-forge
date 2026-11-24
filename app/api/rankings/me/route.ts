import { NextRequest } from "next/server";
import { readRankingsMe } from "@/lib/rankings-me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The visitor's own inputs to the career rankings page (lib/rankings-me.ts). */
export async function GET(req: NextRequest) {
  return Response.json(await readRankingsMe(req), { headers: { "cache-control": "no-store" } });
}
