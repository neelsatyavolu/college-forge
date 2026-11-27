import type { FollowerRole, ParentLevel } from "./parents";
import type { Workspace } from "./store";
import { shareTracker } from "./tracker-service";
import { sharedAidPlan } from "./aid-plan";
import { sharedScholarship } from "./aid-validate";

/**
 * What a parent or counselor sees of a student, by level. Never: portal logins, uploads, AI chance estimates,
 * share tokens, recovery codes, or a decision the student hasn't opened. Advisor notes only for a counselor,
 * and then only the notes counselors left (`counselorNotes`).
 *
 *  basic     applications, statuses, deadlines and opened decisions
 *  standard  basic + to-dos and flags, the college list, recommendation letters, scholarships (no amounts for a
 *            school's own awards), financial aid and the per-school aid form checklist
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

const RANK: Record<ParentLevel, number> = { basic: 0, standard: 1, full: 2 };

/**
 * Notes counselors left. A note can quote whatever its author could see, so a counselor sees another's note
 * only when they share at least that author's level (a note without one counts as full); their own always.
 * `mine` marks the ones this counselor link wrote; an essay id only where essays show.
 */
export function counselorNotes(ws: Workspace, level: ParentLevel, linkId: string) {
  return ws.advisorNotes
    .filter((n) => n.via === "counselor" && (n.byLink === linkId || RANK[n.authorLevel ?? "full"] <= RANK[level]))
    .map((n) => ({
      id: n.id, body: n.body, author: n.author, createdAt: n.createdAt, mine: n.byLink === linkId,
      ...(level === "full" && n.essayId ? { essayId: n.essayId } : {}),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function followerView(ws: Workspace, access: { level: ParentLevel; role: FollowerRole; linkId: string }, today?: string) {
  const view = parentView(ws, access.level, today);
  return access.role === "counselor" ? { ...view, role: access.role, notes: counselorNotes(ws, access.level, access.linkId) } : { ...view, role: access.role };
}

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
    // A recommender's email and the brag sheet are private like notes: only the "full" level keeps them.
    recommendations: ws.recommendations.map(({ notes, email, bragSheet, ...r }) => (keepNotes ? { ...r, notes, email, bragSheet } : r)),
    // A school's own award comes from its decision letter, so its amount stays private to the student.
    scholarships: ws.scholarships.map(({ notes, ...s }) => ({ ...sharedScholarship(s), ...(keepNotes ? { notes } : {}) })),
    financialAid: { fafsaStatus: ws.financialAid.fafsaStatus, cssStatus: ws.financialAid.cssStatus, idocStatus: ws.financialAid.idocStatus ?? "n_a", fafsaOpenDate: ws.financialAid.fafsaOpenDate },
    /** Which aid forms each school needs and when (no offers, amounts or letters). */
    aidBySchool: sharedAidPlan(ws, today),
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
