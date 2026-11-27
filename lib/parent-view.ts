import type { FollowerLevel, FollowerRole, ParentLevel } from "./parents";
import type { Essay, Workspace } from "./store";
import { isEssayHidden } from "./essay-tools";
import { shareTracker } from "./tracker-service";
import { sharedAidPlan } from "./aid-plan";
import { sharedScholarship } from "./aid-validate";
import { UC_APPLICATION_SLUG } from "./essay-supplements";

/**
 * What a parent or counselor sees of a student, by level. Never: portal logins, uploads, AI chance estimates,
 * share tokens, recovery codes, or a decision the student hasn't opened. Advisor notes only for a counselor,
 * and then only the notes counselors left (`counselorNotes`).
 *
 *  basic     applications, statuses, deadlines and opened decisions
 *  standard  basic + to-dos and flags, the college list, recommendation letters, scholarships (no amounts for a
 *            school's own awards), financial aid and the per-school aid form checklist
 *  full      standard + profile (GPA, scores, activities, honors) and essays with drafts
 *  essays    a writing coach: essay prompts, drafts, writing status and the school name of each supplement
 *            group, plus the comments that coach left (essaysView, coachNotes). Nothing from the tracker,
 *            list or profile.
 */
/** `summary` is written to the student, `forParent` to the parent. */
export const PARENT_LEVEL_INFO: Record<FollowerLevel, { label: string; summary: string; forParent: string }> = {
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
  essays: {
    label: "Essays",
    summary: "Your essays and drafts only. They can comment on each essay.",
    forParent: "their essays and drafts only, and you can comment on each essay",
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

/**
 * A writing coach's view, picked field by field so anything added to the workspace later stays out. Drafts and
 * statuses only for essays that exist; supplement groups carry the school's name and nothing else about it.
 */
export function essaysView(ws: Workspace) {
  const first = (ws.applicant.name || "").trim().split(/\s+/)[0] || "";
  const pick = ({ id, label, prompt, limit, unit, required, chooseGroup, choose, options, audience }: Workspace["essays"]["commonApp"][number]) =>
    ({ id, label, prompt, limit, unit, required, chooseGroup, choose, options, audience });
  // An essay the student hid is not shown to the coach, nor its draft, status or comments.
  const shown = (list: Essay[]) => (list || []).filter((e) => !isEssayHidden(ws, e)).map(pick);
  const commonApp = shown(ws.essays.commonApp);
  const supplements = Object.fromEntries(Object.entries(ws.essays.supplements).map(([slug, items]) => [slug, shown(items)] as const).filter(([, items]) => items.length));
  const ids = new Set([...commonApp, ...Object.values(supplements).flat()].map((e) => e.id));
  const named = (slug: string) => {
    if (slug === UC_APPLICATION_SLUG) return "UC Application";
    const c = ws.colleges.find((x) => x.slug === slug);
    return (c && (c.short || c.name)) || slug;
  };
  const only = <T,>(map: Record<string, T> | undefined) => Object.fromEntries(Object.entries(map || {}).filter(([id]) => ids.has(id)));
  return {
    level: "essays" as const,
    student: { name: first, cycle: ws.applicant.cycle || "" },
    essays: { commonApp, supplements },
    schools: Object.keys(supplements).map((slug) => ({ slug, name: named(slug) })),
    essayDrafts: only(ws.essayDrafts),
    essayStatus: only(ws.essayStatus),
  };
}

/** The comments one coach link left, newest first. A coach never sees a parent's, counselor's or other coach's. */
export function coachNotes(ws: Workspace, linkId: string) {
  return ws.advisorNotes
    .filter((n) => n.via === "coach" && n.byLink === linkId && n.essayId)
    .map((n) => ({ id: n.id, body: n.body, author: n.author, createdAt: n.createdAt, essayId: n.essayId!, mine: true }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** What /api/parent/[id] returns for one follower: the level-cut view, plus a counselor's notes or a coach's own comments. */
export function followerView(ws: Workspace, access: { level: FollowerLevel; role: FollowerRole; linkId: string }, today?: string) {
  if (access.role === "coach" || access.level === "essays") {
    const view = essaysView(ws);
    const ids = new Set([...view.essays.commonApp, ...Object.values(view.essays.supplements).flat()].map((e) => e.id));
    return { ...view, role: "coach" as const, notes: coachNotes(ws, access.linkId).filter((n) => ids.has(n.essayId)) };
  }
  const level = access.level;
  const view = parentView(ws, level, today);
  return access.role === "counselor" ? { ...view, role: access.role, notes: counselorNotes(ws, level, access.linkId) } : { ...view, role: access.role };
}

/** The essays a parent may see: everything the student hasn't hidden, without the hidden ones' drafts and statuses. */
function visibleEssays(ws: Workspace) {
  const all = [...ws.essays.commonApp, ...Object.values(ws.essays.supplements || {}).flat()];
  const hidden = new Set(all.filter((e) => isEssayHidden(ws, e)).map((e) => e.id));
  const shown = (list: Essay[]) => (list || []).filter((e) => !hidden.has(e.id));
  const commonApp = shown(ws.essays.commonApp);
  const supplements = Object.fromEntries(Object.entries(ws.essays.supplements || {}).map(([k, v]) => [k, shown(v)] as const).filter(([, v]) => v.length));
  const only = <T,>(map: Record<string, T> | undefined) => Object.fromEntries(Object.entries(map || {}).filter(([k]) => !hidden.has(k)));
  return { essays: { commonApp, supplements }, essayDrafts: only(ws.essayDrafts), essayStatus: only(ws.essayStatus) };
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
    // Hidden essays and unchosen Common App prompts, with their drafts, never leave the server.
    ...visibleEssays(ws),
  };
}
