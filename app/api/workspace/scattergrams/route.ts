import { NextRequest } from "next/server";
import { deleteScattergramText, getWorkspace, readScattergramText, writeScattergramText } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { sameOrigin, sameSite } from "@/lib/same-site";
import { applyScattergramImport, decodeScattergramDoc, ScattergramInputError, type ImportableCollege } from "@/lib/scattergrams";
import { US_NEWS_BY_SLUG, US_NEWS_TOP_250 } from "@/lib/us-news-rankings";
import { CATALOG } from "@/lib/explore-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Any school the student might look up: the Explore catalog, the U.S. News top 250 and their own list (which wins). */
function importable(list: { slug: string; name: string }[]): ImportableCollege[] {
  return [...CATALOG, ...US_NEWS_TOP_250, ...list].map((c) => ({ slug: c.slug, name: c.name, rank: US_NEWS_BY_SLUG.get(c.slug)?.rank ?? null }));
}

/** GET: the student's imported Maia scattergrams, or null when none. */
export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  const doc = decodeScattergramDoc(await readScattergramText(id));
  return json({ success: true, data: doc }, 200, setCookie);
}

/** POST: merge an import (from the Maia bookmarklet popup) into the stored scattergrams. */
export async function POST(req: NextRequest) {
  if (!sameSite(req)) return json({ success: false, error: "Not allowed." }, 403);
  const { id, setCookie } = await getWorkspaceId(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body." }, 400, setCookie);
  }
  try {
    const ws = await getWorkspace(id);
    const existing = decodeScattergramDoc(await readScattergramText(id));
    const { doc, skipped } = applyScattergramImport(existing, body, importable(ws.colleges));
    await writeScattergramText(id, JSON.stringify(doc));
    return json({ success: true, data: { scattergrams: doc, skipped } }, 200, setCookie);
  } catch (error) {
    if (error instanceof ScattergramInputError) return json({ success: false, error: error.message }, 400, setCookie);
    console.error("[scattergrams] save failed", error instanceof Error ? error.name : "unknown");
    return json({ success: false, error: "Couldn't save the scattergrams. Try again." }, 500, setCookie);
  }
}

/** DELETE: remove all imported scattergram data for this workspace. */
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return json({ success: false, error: "Not allowed." }, 403);
  const { id, setCookie } = await getWorkspaceId(req);
  await deleteScattergramText(id);
  return json({ success: true, data: null }, 200, setCookie);
}
