/**
 * What a student's plan is still missing, so the copilot knows which
 * schools to research when it builds or refreshes the hub.
 */

import type { College, Essay, Workspace } from "./store";
import { isUcCampus } from "./seed-college-list";
import { supplementsLookReal } from "./essay-supplements";

export type PlanReadiness = {
  /** Slugs of schools with no saved application deadline. */
  missingDeadlines: string[];
  essays: {
    /** Prompts are current-cycle (official scrape or copilot-verified). */
    current: string[];
    /** Prior-cycle or CollegeVine prompts that still need confirming. */
    unconfirmed: string[];
    /** Placeholder slots with no real prompt loaded. */
    placeholder: string[];
  };
};

// Matches the caveat lib/supplement-prompts.ts appends to unverified prompts.
const UNCONFIRMED = /confirm on the school's site/i;

function hasDeadline(c: College): boolean {
  return Boolean(c.deadlines?.length || c.deadline?.trim());
}

function essayStatus(essays: Essay[]): keyof PlanReadiness["essays"] {
  if (!supplementsLookReal(essays)) return "placeholder";
  return essays.some((e) => UNCONFIRMED.test(e.prompt || "")) ? "unconfirmed" : "current";
}

export function planReadiness(ws: Workspace): PlanReadiness {
  const colleges = ws.colleges.filter((c) => c.slug);
  const essays: PlanReadiness["essays"] = { current: [], unconfirmed: [], placeholder: [] };
  // UC campuses share the fixed Personal Insight Questions.
  for (const c of colleges.filter((c) => !isUcCampus(c))) {
    const group = ws.essays.supplements[c.slug];
    if (group?.length) essays[essayStatus(group)].push(c.slug);
  }
  return {
    missingDeadlines: colleges.filter((c) => !hasDeadline(c)).map((c) => c.slug),
    essays,
  };
}
