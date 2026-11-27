import { createHash } from "node:crypto";
import type { Workspace } from "./store";
import { ADJUSTABLE, currentLetter, decisionOf, type TrackedApp } from "./tracker";
import { classifyOutcome } from "./decision-letter";

/**
 * Which applications the Decision board covers, and a fingerprint of everything its AI picks read,
 * so the board can say when saved picks are out of date. A portal decision counts only once the
 * student revealed it (`decision.result`), so the board can't give one away.
 */

export type Standing = "committed" | "admitted" | "waitlisted" | "deferred";

const STANDINGS: readonly string[] = ["committed", "admitted", "waitlisted", "deferred"];

/** A revealed decision's outcome (the letter's, else the portal's words), as viewApp's `decision.result` reads it. */
function revealedResult(app: TrackedApp): string {
  const d = decisionOf(app);
  return d.state === "revealed" ? currentLetter(app)?.result || classifyOutcome(d.portalText) : "";
}

/** The recorded status; for a still-pending application, a revealed result the status hasn't caught up with. */
export function standingOf(app: TrackedApp): Standing | null {
  if (STANDINGS.includes(app.status)) return app.status as Standing;
  if (!ADJUSTABLE.includes(app.status)) return null;
  const result = revealedResult(app);
  return STANDINGS.includes(result) ? (result as Standing) : null;
}

/** Admitted and committed schools, then waitlisted and deferred ones (shown, marked, never picked). */
export function boardApps(ws: Workspace): TrackedApp[] {
  return ws.tracker.apps.filter((app) => standingOf(app) !== null);
}

/** Schools the AI may pick: the ones that admitted the student. */
export function pickableApps(ws: Workspace): TrackedApp[] {
  return ws.tracker.apps.filter((app) => {
    const s = standingOf(app);
    return s === "admitted" || s === "committed";
  });
}

/** The school's own awards the student won (scholarships with kind "school", as decision letters save them). */
export function schoolAwards(ws: Workspace, app: TrackedApp): { name: string; amount: string }[] {
  const keys = new Set([app.slug, app.collegeId].filter((k): k is string => !!k));
  return (ws.scholarships || []).flatMap((s) => {
    if (s.kind !== "school" || !s.slug || !keys.has(s.slug) || s.status !== "won") return [];
    return [{ name: String(s.name || "").slice(0, 120), amount: String(s.amount || "").slice(0, 60) }];
  });
}

/** Changes whenever an input to the picks changes: the schools, their standing, aid and notes, and the student's plans. */
export function boardFingerprint(ws: Workspace): string {
  const p = ws.profile;
  const prefs = ws.onboarding?.listPrefs;
  const iv = ws.onboarding?.interview;
  const major = (a: TrackedApp) => (a.slug ? ws.colleges.find((c) => c.slug === a.slug)?.major ?? "" : "");
  // The offer's updatedAt is left out: saving the same amounts again changes nothing the picks read.
  const offer = (a: TrackedApp) => (a.aidOffer ? { ...a.aidOffer, updatedAt: 0 } : null);
  const input = {
    apps: boardApps(ws).map((a) => [a.id, standingOf(a), offer(a), a.notes || "", a.decisionNote || "", schoolAwards(ws, a), major(a)]),
    intent: [p.intended || "", p.switchTo || "", p.pathNote || "", p.residency || ""],
    prefs: prefs ? [prefs.budget ?? "", prefs.needAid ?? "", prefs.incomeBracket ?? "", prefs.citizenship ?? "", prefs.notes || "", prefs.settings || [], prefs.size || "", prefs.regions || []] : null,
    interview: iv ? [iv.notes || {}, iv.deep || []] : null,
    career: ws.careerSettings ?? null,
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}
