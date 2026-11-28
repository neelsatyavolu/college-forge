import type { Workspace } from "./store";

/**
 * Which school deadlines are aid or scholarship dates, and whether the student wants them shown.
 * No imports beyond types, so the calendar export can use it without loading the research files.
 */

// Same order and words as public/hub/deadline-plan.js (tests/aid.test.cjs keeps them in step).
const AID_KIND = /financial aid|fafsa|css profile|\bcss\b|\baid\b/i;
const SCHOLARSHIP_KIND = /scholarship|merit|fellow/i;
export function deadlineKind(plan: string): "aid" | "scholarship" | null {
  if (AID_KIND.test(plan)) return "aid";
  if (SCHOLARSHIP_KIND.test(plan)) return "scholarship";
  return null;
}

/**
 * Whether to show a school deadline: need-based aid dates are hidden once the student said they aren't
 * applying for aid (listPrefs.needAid false), scholarship dates once they said no to merit aid
 * (interview.meritInterest "no"). Unknown keeps both. Mirrors showsDeadline in public/hub/deadline-plan.js.
 */
export function showsDeadline(plan: string, ws: Pick<Workspace, "onboarding">): boolean {
  const kind = deadlineKind(plan || "");
  if (kind === "aid") return ws.onboarding?.listPrefs?.needAid !== false;
  if (kind === "scholarship") return ws.onboarding?.interview?.meritInterest !== "no";
  return true;
}
