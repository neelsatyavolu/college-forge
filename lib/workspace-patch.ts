import { randomUUID } from "node:crypto";
import type {
  Workspace,
  Activity,
  Honor,
  Recommendation,
  Scholarship,
  ApplicationEntry,
  AdvisorNote,
  FinancialAid,
  Essay,
} from "./store";

function assignDefined<T extends object>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

export type WorkspacePatch = {
  applicant?: Partial<Workspace["applicant"]>;
  profile?: Partial<{
    intended: string;
    hs: string;
    gradYear: number | string;
    location: string;
    counselor: string;
    residency: string;
    testing: Partial<Workspace["profile"]["testing"]>;
    coursework: Partial<Workspace["profile"]["coursework"]>;
    activities: Activity[];
    honors: Honor[];
  }>;
  ed?: Workspace["ed"];
  criticalDates?: Workspace["criticalDates"];
  colleges?: Workspace["colleges"];
  essays?: {
    commonApp?: Essay[];
    supplements?: Record<string, Essay[]>;
  };
  essayDrafts?: Record<string, string>;
  plannerDone?: Record<string, boolean>;
  applications?: Record<string, ApplicationEntry>;
  recommendations?: Recommendation[];
  scholarships?: Scholarship[];
  financialAid?: Partial<FinancialAid>;
  /** Merge a single essay draft */
  essayDraft?: { id: string; text: string };
  /** Toggle one planner task */
  plannerToggle?: { key: string; done: boolean };
  /** Set one application status */
  application?: { slug: string } & ApplicationEntry;
  /** Upsert recommendation by id (or create) */
  recommendation?: Partial<Recommendation> & { name?: string };
  removeRecommendationId?: string;
  scholarship?: Partial<Scholarship> & { name?: string };
  removeScholarshipId?: string;
  advisorNote?: { body: string; author?: string; essayId?: string };
  removeAdvisorNoteId?: string;
  /** Patch a single college by slug */
  collegePatch?: { slug: string } & Partial<Workspace["colleges"][number]>;
};

export function applyWorkspacePatch(ws: Workspace, patch: WorkspacePatch): Workspace {
  let next: Workspace = { ...ws };

  if (patch.applicant) {
    next = { ...next, applicant: assignDefined(next.applicant, patch.applicant as Record<string, unknown>) };
  }

  if (patch.profile) {
    const p = patch.profile;
    next = {
      ...next,
      profile: {
        ...next.profile,
        ...(p.intended !== undefined ? { intended: p.intended } : {}),
        ...(p.hs !== undefined ? { hs: p.hs } : {}),
        ...(p.gradYear !== undefined ? { gradYear: p.gradYear } : {}),
        ...(p.location !== undefined ? { location: p.location } : {}),
        ...(p.counselor !== undefined ? { counselor: p.counselor } : {}),
        ...(p.residency !== undefined ? { residency: p.residency } : {}),
        testing: p.testing ? assignDefined(next.profile.testing, p.testing as Record<string, unknown>) : next.profile.testing,
        coursework: p.coursework
          ? assignDefined(next.profile.coursework, p.coursework as Record<string, unknown>)
          : next.profile.coursework,
        activities: Array.isArray(p.activities) ? p.activities : next.profile.activities,
        honors: Array.isArray(p.honors) ? p.honors : next.profile.honors,
      },
    };
    if (Array.isArray(p.honors)) {
      next = { ...next, applicant: { ...next.applicant, awards: p.honors.length } };
    }
  }

  if (patch.ed !== undefined) next = { ...next, ed: patch.ed };
  if (patch.criticalDates) next = { ...next, criticalDates: patch.criticalDates };
  if (patch.colleges) next = { ...next, colleges: patch.colleges };

  if (patch.essays) {
    next = {
      ...next,
      essays: {
        commonApp: patch.essays.commonApp ?? next.essays.commonApp,
        supplements: patch.essays.supplements ?? next.essays.supplements,
      },
    };
  }

  if (patch.essayDrafts) {
    next = { ...next, essayDrafts: { ...next.essayDrafts, ...patch.essayDrafts } };
  }
  if (patch.essayDraft?.id) {
    next = {
      ...next,
      essayDrafts: { ...next.essayDrafts, [patch.essayDraft.id]: patch.essayDraft.text },
    };
  }

  if (patch.plannerDone) {
    next = { ...next, plannerDone: { ...next.plannerDone, ...patch.plannerDone } };
  }
  if (patch.plannerToggle) {
    next = {
      ...next,
      plannerDone: { ...next.plannerDone, [patch.plannerToggle.key]: patch.plannerToggle.done },
    };
  }

  if (patch.applications) {
    next = { ...next, applications: { ...next.applications, ...patch.applications } };
  }
  if (patch.application?.slug) {
    const { slug, ...entry } = patch.application;
    next = {
      ...next,
      applications: {
        ...next.applications,
        [slug]: { ...next.applications[slug], ...entry },
      },
    };
  }

  if (patch.recommendations) next = { ...next, recommendations: patch.recommendations };
  if (patch.recommendation) {
    const r = patch.recommendation;
    const id = r.id || randomUUID().slice(0, 8);
    const existing = next.recommendations.find((x) => x.id === id);
    const row: Recommendation = {
      id,
      name: r.name || existing?.name || "Recommender",
      type: r.type || existing?.type || "teacher",
      subject: r.subject ?? existing?.subject,
      status: r.status || existing?.status || "not_asked",
      deadline: r.deadline ?? existing?.deadline,
      notes: r.notes ?? existing?.notes,
    };
    next = {
      ...next,
      recommendations: existing
        ? next.recommendations.map((x) => (x.id === id ? row : x))
        : [...next.recommendations, row],
    };
  }
  if (patch.removeRecommendationId) {
    next = {
      ...next,
      recommendations: next.recommendations.filter((x) => x.id !== patch.removeRecommendationId),
    };
  }

  if (patch.scholarships) next = { ...next, scholarships: patch.scholarships };
  if (patch.scholarship) {
    const s = patch.scholarship;
    const id = s.id || randomUUID().slice(0, 8);
    const existing = next.scholarships.find((x) => x.id === id);
    const row: Scholarship = {
      id,
      name: s.name || existing?.name || "Scholarship",
      amount: s.amount ?? existing?.amount,
      deadline: s.deadline ?? existing?.deadline,
      status: s.status || existing?.status || "researching",
      url: s.url ?? existing?.url,
      notes: s.notes ?? existing?.notes,
    };
    next = {
      ...next,
      scholarships: existing
        ? next.scholarships.map((x) => (x.id === id ? row : x))
        : [...next.scholarships, row],
    };
  }
  if (patch.removeScholarshipId) {
    next = {
      ...next,
      scholarships: next.scholarships.filter((x) => x.id !== patch.removeScholarshipId),
    };
  }

  if (patch.financialAid) {
    next = { ...next, financialAid: { ...next.financialAid, ...patch.financialAid } };
  }

  if (patch.advisorNote?.body?.trim()) {
    const note: AdvisorNote = {
      id: randomUUID().slice(0, 10),
      body: patch.advisorNote.body.trim(),
      author: (patch.advisorNote.author || "Advisor").slice(0, 80),
      createdAt: Date.now(),
      essayId: patch.advisorNote.essayId,
    };
    next = { ...next, advisorNotes: [...next.advisorNotes, note] };
  }
  if (patch.removeAdvisorNoteId) {
    next = {
      ...next,
      advisorNotes: next.advisorNotes.filter((n) => n.id !== patch.removeAdvisorNoteId),
    };
  }

  if (patch.collegePatch?.slug) {
    const { slug, ...fields } = patch.collegePatch;
    next = {
      ...next,
      colleges: next.colleges.map((c) =>
        c.slug === slug ? { ...c, ...fields, slug: c.slug } : c
      ),
    };
  }

  return next;
}
