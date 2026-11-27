import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { allow } from "@/lib/rate-limit";
import { getWorkspace, redactWorkspaceBody, updateWorkspace, type Workspace } from "@/lib/store";
import { GptzeroError, scanText, summarize } from "@/lib/gptzero";
import { SIGNIN_FAILED, withToken } from "@/lib/gptzero-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST {essayId}: checks the saved draft of one essay with the student's GPTZero account. The text comes from
 * the workspace, never the request, so this can't spend the student's GPTZero words on other text. Saves only
 * the latest totals (essayAiChecks[essayId]); the flagged sentences come back in the response and aren't kept.
 */

const MIN_WORDS = 50;
const MAX_CHARS = 50_000;
/** Same as lib/essay-tools.ts: essay ids can carry periods and colons. */
const ESSAY_ID = /^[\w.:-]{1,200}$/;

const json = (data: unknown, status = 200) => Response.json(redactWorkspaceBody(data), { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status = 400) => json({ success: false, error }, status);

function crossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return true;
  return !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

const essayIds = (ws: Workspace) => new Set([...ws.essays.commonApp, ...Object.values(ws.essays.supplements).flat()].map((e) => e.id));
class StaleDraft extends Error {}
const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Sign in to check an essay.", 401);
  if (crossSite(req)) return fail("Not allowed.", 403);
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("A JSON object is required.");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON");
  }
  const essayId = typeof body.essayId === "string" && ESSAY_ID.test(body.essayId) ? body.essayId : "";
  if (!essayId) return fail("Choose an essay.");
  const id = session.workspaceId;
  try {
    const ws = await getWorkspace(id);
    if (!essayIds(ws).has(essayId)) return fail("That essay isn't in your workspace.", 404);
    const text = (ws.essayDrafts[essayId] || "").trim();
    const count = words(text);
    if (count < MIN_WORDS) return fail(`Write at least ${MIN_WORDS} words first. Shorter text is too short to check reliably.`);
    if (text.length > MAX_CHARS) return fail(`That draft is over ${MAX_CHARS.toLocaleString("en-US")} characters, too long to check.`);
    if (!(await allow(`gptzero-scan:${session.sub}`, 30, 60 * 60 * 1000))) return fail("Too many checks. Try again in an hour.", 429);

    let result;
    try {
      result = summarize(await withToken(id, (token) => scanText(token, text)));
    } catch (err) {
      if (!(err instanceof GptzeroError)) throw err;
      if (err.kind === "login") return fail(SIGNIN_FAILED, 409);
      if (err.kind === "quota") return fail("GPTZero says you're out of checks for now. Check your GPTZero plan, or try again later.", 429);
      return fail("GPTZero isn't answering right now. Try again later.", 502);
    }

    const check = result.verdict === "unknown"
      ? null
      : { checkedAt: Date.now(), verdict: result.verdict, ai: result.ai, mixed: result.mixed, human: result.human, words: count };
    const next = check
      ? await updateWorkspace(id, (cur) => {
          // An edit (or a newer check) landed while GPTZero was working: this result is for an older draft.
          if ((cur.essayDrafts[essayId] || "").trim() !== text) throw new StaleDraft();
          return { ...cur, essayAiChecks: { ...(cur.essayAiChecks || {}), [essayId]: check } };
        }).catch(async (err) => {
          if (err instanceof StaleDraft) return getWorkspace(id);
          throw err;
        })
      : ws;
    return json({ success: true, data: next, result });
  } catch (err) {
    console.error("api/gptzero/scan failed", err instanceof Error ? err.name : "unknown");
    return fail("Couldn't check that essay. Try again.", 500);
  }
}
