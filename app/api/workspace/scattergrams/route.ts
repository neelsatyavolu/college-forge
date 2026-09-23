import { NextRequest } from "next/server";
import { deleteScattergramText, getWorkspace, readScattergramText, writeScattergramText } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { applyScattergramImport, decodeScattergramDoc, ScattergramInputError } from "@/lib/scattergrams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** GET: the student's imported Maia scattergrams, or null when none. */
export async function GET(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  const doc = decodeScattergramDoc(await readScattergramText(id));
  return json({ success: true, data: doc }, 200, setCookie);
}

/** POST: merge an import (from the Maia bookmarklet popup) into the stored scattergrams. */
export async function POST(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body." }, 400, setCookie);
  }
  try {
    const ws = await getWorkspace(id);
    const existing = decodeScattergramDoc(await readScattergramText(id));
    const { doc, skipped } = applyScattergramImport(existing, body, ws.colleges);
    await writeScattergramText(id, JSON.stringify(doc));
    return json({ success: true, data: { scattergrams: doc, skipped } }, 200, setCookie);
  } catch (error) {
    if (error instanceof ScattergramInputError) return json({ success: false, error: error.message }, 400, setCookie);
    throw error;
  }
}

/** DELETE: remove all imported scattergram data for this workspace. */
export async function DELETE(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  await deleteScattergramText(id);
  return json({ success: true, data: null }, 200, setCookie);
}
