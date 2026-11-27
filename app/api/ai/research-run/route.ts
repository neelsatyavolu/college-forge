import { NextRequest, after } from "next/server";
import { getWorkspace, updateWorkspace, type Workspace } from "@/lib/store";
import { importCurated } from "@/lib/research-plan";
import { beginRun, isRunActive, stageOf, workerTick, STALE_WORKER_MS } from "@/lib/research-runner";
import { clearVault, loadVault, saveVault, signRun, vaultAvailable, verifyRun, type VaultProvider } from "@/lib/token-vault";
import { getActiveCodexSession, readSessionCookie, writeSessionCookie } from "@/lib/codex-session";
import { getActiveGrokSession, readGrokSessionCookie, writeGrokSessionCookie } from "@/lib/grok-session";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { sameSite } from "@/lib/same-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One worker invocation researches one school (its step ends by 230 s), then hands off.
export const maxDuration = 300;

const noStore = { "cache-control": "no-store" };
const MAX_MODEL = 80;

/** Where hand-offs go: Forge's own fixed origin, never a host taken from the request in production. */
function selfOrigin(req: NextRequest): string | null {
  if (process.env.FORGE_ORIGIN) return process.env.FORGE_ORIGIN.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NODE_ENV === "production" ? null : new URL(req.url).origin;
}

/** Hands this worker's next school to a fresh invocation. */
async function handOff(origin: string, workspaceId: string, runId: string, worker: number, failures: number): Promise<void> {
  try {
    const res = await fetch(`${origin}/api/ai/research-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "continue", ws: workspaceId, runId, worker, failures, sig: signRun(workspaceId, runId, worker) }),
    });
    if (!res.ok) console.error(`[research-run] hand-off for worker ${worker} got ${res.status}`);
  } catch (err) {
    console.error(`[research-run] hand-off for worker ${worker} failed:`, err instanceof Error ? err.message : "unknown");
  }
}

/** Runs one school for a worker after the response, then hands off if there's more. */
function schedule(origin: string, workspaceId: string, runId: string, worker: number, failures = 0) {
  after(async () => {
    const next = await workerTick(workspaceId, runId, worker, failures);
    if (next !== null) await handOff(origin, workspaceId, runId, worker, next);
  });
}

function view(ws: Workspace) {
  const run = ws.onboarding.interview?.researchRun;
  return {
    active: isRunActive(run),
    finished: Boolean(run?.finishedAt),
    error: run?.error ?? "",
    cards: ws.colleges.map((c) => ({
      slug: c.slug,
      name: c.short || c.name,
      stage: c.research?.complete || c.research?.needsReview ? stageOf(c) : run?.live?.[c.slug] ?? stageOf(c),
      facts: c.research?.facts?.length || 0,
      round: c.deadline || "",
    })),
  };
}

/** Keeps the browser's sign-in and the stored one on the same (newest) tokens: refresh tokens rotate. */
async function syncTokens(workspaceId: string): Promise<void> {
  const entry = await loadVault(workspaceId);
  if (!entry) return;
  const cookie = entry.provider === "codex" ? await readSessionCookie() : await readGrokSessionCookie();
  if (!cookie) return;
  if (entry.tokens.expiresAt > cookie.expiresAt) {
    await (entry.provider === "codex" ? writeSessionCookie(entry.tokens) : writeGrokSessionCookie(entry.tokens));
  } else if (cookie.expiresAt > entry.tokens.expiresAt) {
    await saveVault(workspaceId, { ...entry, tokens: cookie, savedAt: Date.now() });
  }
}

/** Progress for the onboarding cards; restarts workers that died while the tab was away. */
export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  if (setCookie) return Response.json({ error: "Open your hub first." }, { status: 400 });
  await syncTokens(id).catch(() => undefined);
  let ws = await getWorkspace(id);
  const run = ws.onboarding.interview?.researchRun;
  const origin = selfOrigin(req);
  if (origin && isRunActive(run) && (await loadVault(id)) && Object.values(run.heartbeats).some((t) => Date.now() - t > STALE_WORKER_MS)) {
    let start: number[] = [];
    ws = await updateWorkspace(id, (w) => { const r = beginRun(w); start = r.start; return r.ws; });
    const runId = ws.onboarding.interview!.researchRun!.runId;
    for (const worker of start) schedule(origin, id, runId, worker);
  }
  return Response.json(view(ws), { headers: noStore });
}

/**
 * action "start" (the student's browser): store the AI sign-in, import curated research and start the
 * workers, or restart the dead ones of a run already going.
 * action "continue" (Forge itself, signed): research this worker's next school.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid body." }, { status: 400 });
  const origin = selfOrigin(req);

  if (body.action === "continue") {
    const ws = typeof body.ws === "string" ? body.ws.slice(0, 80) : "";
    const runId = typeof body.runId === "string" ? body.runId.slice(0, 80) : "";
    const worker = Number.isInteger(body.worker) ? (body.worker as number) : -1;
    const failures = Number.isInteger(body.failures) ? Math.max(0, Math.min(5, body.failures as number)) : 0;
    if (!ws || !runId || worker < 0 || worker > 15 || !verifyRun(ws, runId, worker, String(body.sig ?? ""))) {
      return Response.json({ error: "Not allowed." }, { status: 403 });
    }
    if (!origin) return Response.json({ error: "Unavailable." }, { status: 503 });
    schedule(origin, ws, runId, worker, failures);
    return Response.json({ ok: true }, { status: 202, headers: noStore });
  }

  if (body.action !== "start") return Response.json({ error: "Unknown action." }, { status: 400 });
  if (!sameSite(req)) return Response.json({ error: "Not allowed." }, { status: 403 });
  // Without the server key the browser runs research itself, as before.
  if (!vaultAvailable() || !origin) return Response.json({ error: "Background research isn't set up.", fallback: true }, { status: 503 });
  const { id, setCookie } = await getWorkspaceId(req);
  if (setCookie) return Response.json({ error: "Open your hub first." }, { status: 400 });

  const preferred = body.provider === "codex" || body.provider === "grok" ? body.provider : undefined;
  const pick = async (): Promise<{ provider: VaultProvider; tokens: NonNullable<Awaited<ReturnType<typeof getActiveCodexSession>>> } | null> => {
    const grok = preferred === "codex" ? null : await getActiveGrokSession().catch(() => null);
    if (grok) return { provider: "grok", tokens: grok };
    const codex = preferred === "grok" ? null : await getActiveCodexSession().catch(() => null);
    return codex ? { provider: "codex", tokens: codex } : null;
  };
  const signIn = await pick();
  if (!signIn) return Response.json({ error: "Connect ChatGPT or Grok to research your schools." }, { status: 400 });
  const model = typeof (signIn.provider === "codex" ? body.codexModel : body.grokModel) === "string"
    ? String(signIn.provider === "codex" ? body.codexModel : body.grokModel).slice(0, MAX_MODEL) : undefined;
  await saveVault(id, { provider: signIn.provider, tokens: signIn.tokens, ...(model ? { model } : {}), savedAt: Date.now() });

  let start: number[] = [];
  const ws = await updateWorkspace(id, (w) => {
    const r = beginRun(importCurated(w));
    start = r.start;
    return r.ws;
  });
  const runId = ws.onboarding.interview?.researchRun?.runId;
  if (!runId) {
    await clearVault(id);
    return Response.json({ error: "Finish the interview before research." }, { status: 400 });
  }
  for (const worker of start) schedule(origin, id, runId, worker);
  return Response.json(view(ws), { headers: noStore });
}
