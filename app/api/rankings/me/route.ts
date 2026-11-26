import { NextRequest } from "next/server";
import { careerSettingsSchema } from "@/lib/career-settings";
import { allow } from "@/lib/rate-limit";
import { readRankingsMe, saveRankingsSettings } from "@/lib/rankings-me";
import { sameSite } from "@/lib/same-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store" };
const MAX_BODY = 4_000;
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: HEADERS });

/** The visitor's own inputs to the career rankings page (lib/rankings-me.ts). */
export async function GET(req: NextRequest) {
  return Response.json(await readRankingsMe(req), { headers: HEADERS });
}

/** PUT {targets?, weights?, flags?}: saves the career-ranking settings on the visitor's own workspace. */
export async function PUT(req: NextRequest) {
  if (!sameSite(req)) return fail(403, "Not allowed.");
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return fail(413, "Request too large.");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return fail(400, "Invalid JSON."); }
  const input = careerSettingsSchema.safeParse(body);
  if (!input.success) return fail(400, "Invalid ranking settings.");
  try {
    const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!(await allow(`career-settings:${key}`, 300, 60 * 60 * 1000))) return fail(429, "Too many changes. Try again later.");
    const saved = await saveRankingsSettings(req, input.data);
    return Response.json({ ok: true, saved }, { headers: HEADERS });
  } catch (err) {
    console.error("rankings settings save failed", err instanceof Error ? err.message : "unknown");
    return fail(500, "Forge couldn't save that just now. Try again.");
  }
}
