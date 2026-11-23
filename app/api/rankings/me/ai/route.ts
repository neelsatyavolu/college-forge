import { NextRequest } from "next/server";
import { CAREER_AI_MAX_CHARS, parseCareerAi } from "@/lib/career-ai";
import { allow } from "@/lib/rate-limit";
import { deleteCareerAiText, saveCareerAiText } from "@/lib/store";
import { getSession } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: HEADERS });

/** The signed-in account's workspace, for a same-site request. Anonymous visitors can't store a judged list. */
function accountWorkspace(req: NextRequest): string | Response {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get("host")) return fail(403, "Not allowed.");
    } catch {
      return fail(403, "Not allowed.");
    }
  }
  const session = getSession(req);
  return session?.workspaceId ?? fail(401, "Sign in to save your own judged list.");
}

/** Saves the student's judged ranking (a JSON file in the lib/career-ai.ts shape), replacing any earlier one. */
export async function PUT(req: NextRequest) {
  const id = accountWorkspace(req);
  if (typeof id !== "string") return id;
  try {
    if (!(await allow(`career-ai:${id}`, 20, 60 * 60 * 1000))) return fail(429, "Too many uploads. Try again later.");
    const text = await req.text();
    if (text.length > CAREER_AI_MAX_CHARS) return fail(413, "That file is too large.");
    const list = parseCareerAi(text);
    if (!list) return fail(400, "That file isn't a judged ranking list.");
    await saveCareerAiText(id, JSON.stringify(list));
    return Response.json({ ok: true, ai: list }, { headers: HEADERS });
  } catch (err) {
    console.error("career ai save failed", err instanceof Error ? err.message : "unknown");
    return fail(500, "Forge couldn't save that just now. Try again.");
  }
}

/** Removes the student's judged ranking. */
export async function DELETE(req: NextRequest) {
  const id = accountWorkspace(req);
  if (typeof id !== "string") return id;
  try {
    await deleteCareerAiText(id);
    return Response.json({ ok: true }, { headers: HEADERS });
  } catch (err) {
    console.error("career ai delete failed", err instanceof Error ? err.message : "unknown");
    return fail(500, "Forge couldn't remove that just now. Try again.");
  }
}
