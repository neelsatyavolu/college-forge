/**
 * One round per school. The Timeline, Shortlist and school page keep the round on the list school
 * (`college.deadline`, "EA · Nov 1"); Progress and Portals keep it on the application (`app.round` and its
 * deadline). After a write, whichever side the write changed is copied to the other, so they never disagree.
 * Pure; leaves the workspace as it is when nothing changed or both sides changed at once.
 */
import type { College, Workspace } from "./store";
import { deadlineKind } from "./aid-deadlines";
import { effectiveRound, type RoundId, type TrackedApp } from "./tracker";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The application round a deadline's plan names ("ED II" → "ED2", "Regular Decision" → "RD"), or "" when none. */
export function roundIdOf(plan: string): RoundId {
  const p = String(plan || "");
  if (!p.trim() || deadlineKind(p)) return "";
  if (/\bED\s?(II|2)\b|early decision\s?(II|2)\b/i.test(p)) return "ED2";
  if (/\bED\b|early decision/i.test(p)) return "ED";
  if (/\b(REA|SCEA)\b|restrictive|single[- ]choice/i.test(p)) return "REA";
  if (/\bEA\b|early action/i.test(p)) return "EA";
  if (/\bRD\b|regular/i.test(p)) return "RD";
  if (/rolling/i.test(p)) return "Rolling";
  return "";
}

const chosenPlan = (c: College | undefined) => String(c?.deadline || "").split("·")[0].trim();

function label(plan: string, date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${plan} · ${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}` : plan;
}

/** The college's deadline for an application round, if it has one. */
function deadlineFor(c: College, round: RoundId) {
  return round ? (c.deadlines || []).find((d) => d && roundIdOf(d.plan) === round) : undefined;
}

function collegeFor(ws: Workspace, app: TrackedApp): College | undefined {
  return app.slug ? ws.colleges.find((c) => c.slug === app.slug) : undefined;
}

/** Copies a round picked on either side to the other. `before` is the workspace before the write. */
export function syncRounds(before: Workspace, after: Workspace): Workspace {
  const prevApps = new Map((before.tracker?.apps ?? []).map((a) => [a.id, a] as const));
  const collegePatch = new Map<string, string>();
  let appsChanged = false;
  const apps = (after.tracker?.apps ?? []).map((app) => {
    const college = collegeFor(after, app);
    const prevApp = prevApps.get(app.id);
    if (!college || !prevApp) return app;
    const prevCollege = before.colleges.find((c) => c.slug === college.slug);
    const collegeMoved = chosenPlan(prevCollege) !== chosenPlan(college);
    const appMoved = effectiveRound(prevApp) !== effectiveRound(app);
    if (collegeMoved === appMoved) return app;
    if (collegeMoved) {
      const plan = chosenPlan(college);
      const match = (college.deadlines || []).find((d) => d && d.plan.trim().toLowerCase() === plan.toLowerCase());
      const round = roundIdOf(plan);
      if (!round || round === app.round) return app;
      appsChanged = true;
      return { ...app, round, ...(match?.date ? { deadline: match.date } : {}) };
    }
    const round = effectiveRound(app) as RoundId;
    if (roundIdOf(chosenPlan(college)) === round) return app;
    const match = deadlineFor(college, round);
    // No deadline saved for that round: clear the list's pick so the application's own date is the one used.
    collegePatch.set(college.slug, match ? label(match.plan, match.date) : "");
    return app;
  });
  if (!appsChanged && !collegePatch.size) return after;
  const colleges = collegePatch.size
    ? after.colleges.map((c) => (collegePatch.has(c.slug) ? { ...c, deadline: collegePatch.get(c.slug) } : c))
    : after.colleges;
  return { ...after, colleges, tracker: { ...after.tracker, apps } };
}
