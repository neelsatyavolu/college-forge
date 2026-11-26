import type { ParentLevel } from "./parents";
import type { Workspace } from "./store";
import { shareTracker } from "./tracker-service";

/**
 * What a parent sees of a student, by level. Read-only, and never: portal logins, uploads, AI chance
 * estimates, share tokens, recovery codes, advisor notes, or a decision the student hasn't opened.
 *
 *  basic     applications, statuses, deadlines and opened decisions
 *  standard  basic + to-dos and flags, the college list, recommendation letters, scholarships, financial aid
 *  full      standard + profile (GPA, scores, activities, honors) and essays with drafts
 */
/** `summary` is written to the student, `forParent` to the parent. */
export const PARENT_LEVEL_INFO: Record<ParentLevel, { label: string; summary: string; forParent: string }> = {
  basic: {
    label: "Basic",
    summary: "Applications, statuses, deadlines and decisions you've opened.",
    forParent: "applications, statuses, deadlines and decisions once they've opened them",
  },
  standard: {
    label: "Standard",
    summary: "Basic, plus to-dos, your college list, letters, scholarships and financial aid.",
    forParent: "applications, statuses, deadlines, opened decisions, to-dos, their college list, letters, scholarships and financial aid",
  },
  full: {
    label: "Full",
    summary: "Standard, plus your profile (GPA, scores, activities) and essay drafts. Read-only.",
    forParent: "everything in their applications, including their profile (GPA, scores, activities) and essay drafts, read-only",
  },
};

export function parentView(ws: Workspace, level: ParentLevel, today?: string) {
  const progress = shareTracker(ws.tracker, today);
  const student = { name: (ws.applicant.name || "").trim(), cycle: ws.applicant.cycle || "" };
  const criticalDates = ws.criticalDates.map(({ date, label, detail }) => ({ date, label, detail }));

  if (level === "basic") {
    return {
      level,
      student,
      progress: { flags: [], apps: progress.apps.map(({ followUps: _f, missing: _m, ...app }) => ({ ...app, followUps: [], missing: [] })) },
      criticalDates,
    };
  }

  const keepNotes = level === "full";
  const standard = {
    level,
    student,
    progress,
    criticalDates,
    colleges: ws.colleges.map((c) => ({
      slug: c.slug, name: c.name, short: c.short, location: c.location, tier: c.tier, deadline: c.deadline,
      admit: c.admit, netPrice: c.netPrice, deadlines: c.deadlines, url: c.url,
    })),
    recommendations: ws.recommendations.map(({ notes, ...r }) => (keepNotes ? { ...r, notes } : r)),
    scholarships: ws.scholarships.map(({ notes, ...s }) => (keepNotes ? { ...s, notes } : s)),
    financialAid: { fafsaStatus: ws.financialAid.fafsaStatus, cssStatus: ws.financialAid.cssStatus, fafsaOpenDate: ws.financialAid.fafsaOpenDate },
  };
  if (level === "standard") return standard;

  const a = ws.applicant;
  const p = ws.profile;
  return {
    ...standard,
    applicant: { gpaWeighted: a.gpaWeighted, gpaUnweighted: a.gpaUnweighted, sat: a.sat, satNote: a.satNote, awards: a.awards },
    profile: {
      intended: p.intended, hs: p.hs, gradYear: p.gradYear, location: p.location, counselor: p.counselor,
      testing: p.testing, coursework: p.coursework, activities: p.activities, honors: p.honors,
    },
    ed: ws.ed,
    essays: ws.essays,
    essayDrafts: ws.essayDrafts,
    essayStatus: ws.essayStatus ?? {},
  };
}
