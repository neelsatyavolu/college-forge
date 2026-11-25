/**
 * Applying the draft list the student approved in the onboarding chat. Only schools from the AI's
 * saved draft can be added, and a school already on the list leaves only when the student dropped it,
 * so essays, drafts and tracker rows stay attached to every school they kept.
 */
import type { UiSchool } from "./chat-types";
import type { College, Workspace } from "./store";
import { slugify } from "./colleges";
import { recommendColleges } from "./college-recommendations";
import { syncEssaySupplements } from "./essay-supplements";
import { firstIncomplete } from "./interview-checklist";
import { interviewOf } from "./interview-tools";

const TIER: Record<UiSchool["tier"], NonNullable<College["tier"]>> = { reach: "reach", target: "target", likely: "safety" };
const same = (c: { slug?: string; name: string }, ref: string) => c.slug === ref || slugify(c.name) === slugify(ref);

/** Formula rows by slug, so approved formula picks keep their admit, SAT and price data. */
function formulaRows(ws: Workspace): College[] {
  try {
    return recommendColleges(ws).recommendations.map((r) => r.college as College);
  } catch {
    return [];
  }
}

export function applyApprovedList(ws: Workspace, keep: string[], drop: string[], rows: College[] = formulaRows(ws)): Workspace | { error: string } {
  const draft = interviewOf(ws).listDraft ?? [];
  if (!draft.length) return { error: "There is no draft list to approve yet." };
  const kept = draft.filter((s) => keep.some((k) => same(s, k)));
  const current = ws.colleges.filter((c) => !drop.some((d) => same(c, d)));
  const added: College[] = kept
    .filter((s) => !current.some((c) => same(c, s.slug || s.name) || same(c, s.name)))
    .map((s) => {
      const row = rows.find((r) => same(r, s.slug || s.name) || same(r, s.name));
      const slug = row?.slug || s.slug || slugify(s.name);
      return { ...(row ?? { slug, name: s.name, short: s.name }), slug, tier: TIER[s.tier], origin: "agent" as const };
    });
  const tiered = current.map((c) => {
    const s = kept.find((k) => same(c, k.slug || k.name) || same(c, k.name));
    return s ? { ...c, tier: TIER[s.tier] } : c;
  });
  const next: Workspace = { ...ws, colleges: [...tiered, ...added] };
  return syncEssaySupplements({ ...next, onboarding: { ...next.onboarding, interview: { ...interviewOf(next), phase: "research" } } });
}

/** Marks onboarding done without rebuilding the list the student approved. */
export function finishOnboarding(ws: Workspace, now: number): Workspace | { error: string } {
  const gap = firstIncomplete(ws);
  if (gap) return { error: `Setup isn't finished: ${gap} still needs answers.` };
  return { ...ws, onboarding: { ...ws.onboarding, completed: true, completedAt: now, interview: { ...interviewOf(ws), phase: "done" } } };
}

const CLIENT_PHASES = new Set(["research", "plan"]);

/** The client moves the phase forward after research and after the student confirms the strategy. */
export function setInterviewPhase(ws: Workspace, phase: unknown, strategyConfirmed: boolean): Workspace | { error: string } {
  if (typeof phase !== "string" || !CLIENT_PHASES.has(phase)) return { error: "Unknown phase." };
  const iv = interviewOf(ws);
  const strategy = strategyConfirmed && iv.strategy ? { ...iv.strategy, confirmed: true } : iv.strategy;
  return { ...ws, onboarding: { ...ws.onboarding, interview: { ...iv, phase: phase as "research" | "plan", ...(strategy ? { strategy } : {}) } } };
}
