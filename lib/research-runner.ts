/**
 * Background research for onboarding: runs on the server with the student's stored AI sign-in
 * (lib/token-vault.ts), so it keeps going after the tab closes. A run has WORKERS chains; each
 * server invocation researches one school (one step stays inside the 300-second function limit),
 * then hands off to a fresh invocation for the next school. Claims in the workspace keep two
 * workers off the same school, and expire so a crashed worker's school is picked up again.
 */
import { randomUUID } from "node:crypto";
import type { ResearchRun, Workspace } from "./store";
import { getWorkspace, updateWorkspace } from "./store";
import { researchPrompt, researchQueue, recordAttempt } from "./research-plan";
import { runChat } from "./providers";
import { makeHubTools } from "./hub-tools";
import { makeInterviewTools } from "./interview-tools";
import { buildHubSystemPrompt } from "./hub-context";
import { RESEARCH_RULES } from "./interview-prompt";
import { loadScattergrams, scattergramDigest } from "./scattergram-summary";
import { toolAllowed } from "./tool-policy";
import type { WrapUp } from "./tool-budget";
import { loadVault, saveVault, type VaultEntry } from "./token-vault";
import { refreshTokens } from "./codex-oauth";
import { refreshGrokTokens } from "./grok-oauth";

export const WORKERS = 6;
/** A claim outlives one step (wrap-up at 170 s, hard stop at 230 s) with room to spare. */
const CLAIM_MS = 280_000;
/** A worker silent this long has died (its invocation timed out or crashed) and can be restarted. */
export const STALE_WORKER_MS = 320_000;
const REFRESH_BEFORE_MS = 5 * 60_000;

/** Ends each background step well inside the function's 300-second limit. */
export const BACKGROUND_WRAP_UP: WrapUp = {
  afterMs: 170_000,
  deadlineMs: 230_000,
  tools: ["set_school_research", "upsert_college", "set_essays"],
  note: "Time is nearly up for this school. Stop searching: save every verified fact you have now with set_school_research (complete false if any key is still missing), then reply in one sentence.",
};

const runOf = (ws: Workspace): ResearchRun | undefined => ws.onboarding.interview?.researchRun;
const withRun = (ws: Workspace, run: ResearchRun | undefined): Workspace => ({
  ...ws,
  onboarding: { ...ws.onboarding, interview: ws.onboarding.interview ? { ...ws.onboarding.interview, researchRun: run } : ws.onboarding.interview },
});

export const stageOf = (c: Workspace["colleges"][number]): string => (c.research?.complete ? "done" : c.research?.needsReview ? "needs_review" : "queued");

export function isRunActive(run: ResearchRun | undefined): run is ResearchRun {
  return Boolean(run && !run.finishedAt);
}

/** Starts a run, or keeps the current one; returns the run and the workers that need (re)starting. */
export function beginRun(ws: Workspace, now = Date.now()): { ws: Workspace; run: ResearchRun; start: number[] } {
  const current = runOf(ws);
  if (isRunActive(current)) {
    const start = Array.from({ length: current.workers }, (_, i) => i).filter((i) => now - (current.heartbeats[i] ?? 0) > STALE_WORKER_MS);
    const heartbeats = { ...current.heartbeats, ...Object.fromEntries(start.map((i) => [i, now])) };
    const run = { ...current, heartbeats, error: undefined };
    return { ws: withRun(ws, run), run, start };
  }
  const live = Object.fromEntries(ws.colleges.map((c) => [c.slug, stageOf(c)]));
  const run: ResearchRun = { runId: randomUUID(), startedAt: now, workers: WORKERS, claims: {}, live, heartbeats: Object.fromEntries(Array.from({ length: WORKERS }, (_, i) => [i, now])) };
  return { ws: withRun(ws, run), run, start: Array.from({ length: WORKERS }, (_, i) => i) };
}

/** Takes the next unclaimed school for this worker, or null when nothing is left for it. */
export function claimNext(ws: Workspace, runId: string, worker: number, now = Date.now()): { ws: Workspace; slug: string | null } {
  const run = runOf(ws);
  if (!run || run.runId !== runId || run.finishedAt) return { ws, slug: null };
  // Fewest attempts first, then list order: one hard school doesn't hold a worker for three steps in a row.
  const next = researchQueue(ws)
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !((run.claims[c.slug] ?? 0) > now))
    .sort((a, b) => (a.c.research?.attempts ?? 0) - (b.c.research?.attempts ?? 0) || a.i - b.i)[0]?.c;
  const heartbeats = { ...run.heartbeats, [worker]: now };
  if (!next) return { ws: withRun(ws, { ...run, heartbeats }), slug: null };
  return {
    ws: withRun(ws, { ...run, heartbeats, claims: { ...run.claims, [next.slug]: now + CLAIM_MS }, live: { ...run.live, [next.slug]: "searching" } }),
    slug: next.slug,
  };
}

/** Records the step: counts the attempt (three incomplete ones mark the school for review) and frees the claim. */
export function finishStep(ws: Workspace, runId: string, slug: string, ok: boolean): Workspace {
  const counted = ok ? recordAttempt(ws, slug) : ws;
  const run = runOf(counted);
  if (!run || run.runId !== runId) return counted;
  const { [slug]: _, ...claims } = run.claims;
  const c = counted.colleges.find((x) => x.slug === slug);
  return withRun(counted, { ...run, claims, live: { ...run.live, [slug]: c ? stageOf(c) : "done" } });
}

/** Marks the run finished once nothing is queued or claimed. */
export function maybeFinish(ws: Workspace, runId: string, now = Date.now()): { ws: Workspace; finished: boolean } {
  const run = runOf(ws);
  if (!run || run.runId !== runId || run.finishedAt) return { ws, finished: Boolean(run?.finishedAt) };
  const busy = Object.values(run.claims).some((until) => Number(until) > now);
  if (busy || researchQueue(ws).length) return { ws, finished: false };
  return { ws: withRun(ws, { ...run, finishedAt: now, claims: {} }), finished: true };
}

/** The stored sign-in, refreshed by one worker at a time when it is about to expire. */
async function liveTokens(workspaceId: string, runId: string): Promise<VaultEntry> {
  for (let i = 0; i < 20; i++) {
    const entry = await loadVault(workspaceId);
    if (!entry || entry.doneAt) throw new SignInGone();
    if (entry.tokens.expiresAt > Date.now() + REFRESH_BEFORE_MS) return entry;
    let mine = false;
    await updateWorkspace(workspaceId, (w) => {
      const run = runOf(w);
      mine = false;
      if (!run || run.runId !== runId || (run.refreshLease ?? 0) > Date.now()) return w;
      mine = true;
      return withRun(w, { ...run, refreshLease: Date.now() + 60_000 });
    });
    if (mine) {
      try {
        const refreshed = entry.provider === "codex" ? await refreshTokens(entry.tokens.refreshToken) : await refreshGrokTokens(entry.tokens.refreshToken);
        const tokens = { ...refreshed, accountId: refreshed.accountId ?? entry.tokens.accountId };
        const next = { ...entry, tokens, savedAt: Date.now() };
        await saveVault(workspaceId, next);
        return next;
      } finally {
        await updateWorkspace(workspaceId, (w) => {
          const run = runOf(w);
          return run && run.runId === runId ? withRun(w, { ...run, refreshLease: undefined }) : w;
        });
      }
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("Couldn't refresh the AI sign-in for background research.");
}

/** One school's research turn, the same tools and rules as the browser-driven step. */
async function researchOne(workspaceId: string, slug: string, entry: VaultEntry): Promise<void> {
  const ws = await getWorkspace(workspaceId);
  const college = ws.colleges.find((c) => c.slug === slug);
  if (!college) return;
  const hub = makeHubTools(workspaceId, { userText: "", draftStorageKey: ws.draftStorageKey });
  const mutate = (fn: Parameters<typeof updateWorkspace>[1]) => updateWorkspace(workspaceId, (w) => {
    if (w.draftStorageKey !== ws.draftStorageKey) throw new Error("This workspace was reset.");
    return fn(w);
  });
  const noop = () => {};
  const interview = makeInterviewTools(mutate, () => getWorkspace(workspaceId), noop);
  const scatter = scattergramDigest(await loadScattergrams(workspaceId), ws);
  const interviewNames = new Set(interview.tools.map((t) => t.name));
  const tools = [...hub.tools.filter((t) => !interviewNames.has(t.name)), ...interview.tools].filter((t) => toolAllowed("research", t.name));
  const executeTool: typeof hub.executeTool = async (name, argsJson) => {
    if (!toolAllowed("research", name)) return `${name} isn't available here.`;
    return (await interview.execute(name, argsJson)) ?? hub.executeTool(name, argsJson);
  };
  await runChat({
    instructions: `${buildHubSystemPrompt(ws, scatter)}\n\n${RESEARCH_RULES}`,
    turns: [{ role: "user", content: researchPrompt(college, ws) }],
    preferred: entry.provider,
    ...(entry.provider === "codex" ? { codexModel: entry.model } : { grokModel: entry.model }),
    sessions: { codex: entry.provider === "codex" ? entry.tokens : null, grok: entry.provider === "grok" ? entry.tokens : null },
    emit: noop,
    tools,
    executeTool,
    requireTools: true,
    maxRounds: 14,
    wrapUp: BACKGROUND_WRAP_UP,
    effort: "medium",
  });
}

/** A worker that fails this many steps in a row stops; the next status check from the browser restarts it. */
export const MAX_FAILURES = 3;

/**
 * One worker invocation: claim a school, research it, record it. Returns the failure count to hand
 * off with, or null when the worker should stop (nothing left, or too many failures in a row).
 */
export async function workerTick(workspaceId: string, runId: string, worker: number, failures = 0): Promise<number | null> {
  // Tokens first: a refresh can wait on another worker, and that wait must not eat into a school's claim.
  let entry: VaultEntry;
  try {
    entry = await liveTokens(workspaceId, runId);
  } catch (err) {
    if (err instanceof SignInGone) {
      await updateWorkspace(workspaceId, (w) => stopRun(w, runId, SIGN_IN_GONE));
      return null;
    }
    return retry(workspaceId, runId, worker, failures, err);
  }
  let slug: string | null = null;
  await updateWorkspace(workspaceId, (w) => {
    const r = claimNext(w, runId, worker);
    slug = r.slug;
    return r.ws;
  });
  if (!slug) {
    let finished = false;
    await updateWorkspace(workspaceId, (w) => {
      const r = maybeFinish(w, runId);
      finished = r.finished;
      return r.ws;
    });
    // Kept (marked done) until the starting browser takes the newest, possibly rotated, tokens.
    if (finished) await markVaultDone(workspaceId);
    return null;
  }
  const school: string = slug;
  try {
    await researchOne(workspaceId, school, entry);
  } catch (err) {
    // A failed AI call isn't an attempt: the school goes back in the queue.
    await updateWorkspace(workspaceId, (w) => finishStep(w, runId, school, false));
    return retry(workspaceId, runId, worker, failures, err, school);
  }
  await updateWorkspace(workspaceId, (w) => finishStep(w, runId, school, true));
  return 0;
}

export const SIGN_IN_GONE = "Your AI sign-in ended, so research paused. Reconnect ChatGPT or Grok and press Try again.";
const AI_FAILED = "The AI didn't answer for some schools. Forge keeps retrying.";
class SignInGone extends Error {}

/** Ends a run now (sign-in gone, or signed out): the page stops waiting and shows why. */
export function stopRun(ws: Workspace, runId: string | null, message: string, now = Date.now()): Workspace {
  const run = runOf(ws);
  if (!run || run.finishedAt || (runId && run.runId !== runId)) return ws;
  return withRun(ws, { ...run, finishedAt: now, claims: {}, error: message });
}

async function markVaultDone(workspaceId: string): Promise<void> {
  const entry = await loadVault(workspaceId);
  if (entry && !entry.doneAt) await saveVault(workspaceId, { ...entry, doneAt: Date.now() });
}

/** Logs the detail, shows the student a fixed message, and decides whether this worker tries again. */
async function retry(workspaceId: string, runId: string, worker: number, failures: number, err: unknown, school = "-"): Promise<number | null> {
  console.error(`[research-run] ws=${workspaceId.slice(0, 8)} worker=${worker} school=${school} failed:`, err instanceof Error ? err.message : "unknown");
  await updateWorkspace(workspaceId, (w) => {
    const run = runOf(w);
    return run && run.runId === runId && !run.finishedAt ? withRun(w, { ...run, error: AI_FAILED }) : w;
  });
  if (failures + 1 >= MAX_FAILURES) return null;
  await new Promise((r) => setTimeout(r, 15_000));
  return failures + 1;
}
