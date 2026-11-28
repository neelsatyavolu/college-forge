import type { ParentLevel } from "./parents";
import { randomUUID } from "node:crypto";
import type {
  Workspace,
  OnboardingListPrefs,
  Activity,
  Honor,
  Recommendation,
  Scholarship,
  ApplicationEntry,
  AdvisorNote,
  FinancialAid,
  Essay,
} from "./store";
import { mergeSupplements, syncEssaySupplements } from "./essay-supplements";
import { withWebLinks } from "./colleges";
import {
  applyCommonAppPrompt,
  applyEssayHidden,
  applyEssayOption,
  applyEssaySchools,
  applyEssayStatus,
  checkCommonAppPrompt,
  checkEssayHidden,
  checkEssayOption,
  checkEssaySchools,
  checkEssayStatus,
  checkEssaySuggestionDismissals,
  dismissSuggestions,
} from "./essay-tools";
import { checkAidPatch, linkKind, mergeScholarshipList } from "./aid-validate";
import { recExtras, recExtrasError, trackedAppIds, withoutExtras } from "./recommenders";
import { applyAidProfile, parseAidProfile, type AidProfilePatch } from "./aid-profile";
import { parseApplicantFields, parseProfileFields, rankActivities, toAps, toHonors, type Parsed, type WriteMode } from "./profile-fields";

function assignDefined<T extends object>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

export type WorkspacePatch = {
  /** The workspace revision the editor started from. A stale one refuses whole-list replacements (see isStalePatch). */
  baseRevision?: number;
  listPrefs?: Partial<OnboardingListPrefs>;
  applicant?: Partial<Workspace["applicant"]>;
  profile?: Partial<{
    intended: string;
    switchTo: string;
    pathNote: string;
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
  /** Optional family details for the aid estimate; null clears a field (lib/aid-profile.ts). */
  aidProfile?: AidProfilePatch;
  /** Merge a single essay draft */
  essayDraft?: { id: string; text: string };
  /** Mark essays draft or final by id; null clears the mark. */
  essayStatus?: Record<string, "draft" | "final" | null>;
  /** Dismiss copilot suggestions by id (null). Suggestions are only added by suggest_essay_edit. */
  essaySuggestions?: Record<string, null>;
  /** Hide essays by id (true); null shows one again. Drafts are kept either way. */
  essayHidden?: Record<string, true | null>;
  /** Which option of a choose-one prompt the student answers (0-based); null clears it. */
  essayOption?: Record<string, number | null>;
  /** The chosen Common App personal essay prompt (a ca-ps-* id); null clears the choice. */
  commonAppPrompt?: string | null;
  /** Opt schools out of supplements by Essays group key (false); null makes one an essay school again. Drafts are kept. */
  essaySchools?: Record<string, false | null>;
  /** Toggle one planner task */
  plannerToggle?: { key: string; done: boolean };
  /** Set one application status */
  application?: { slug: string } & ApplicationEntry;
  /** Upsert recommendation by id (or create) */
  recommendation?: Partial<Recommendation> & { name?: string };
  removeRecommendationId?: string;
  scholarship?: Partial<Scholarship> & { name?: string };
  removeScholarshipId?: string;
  advisorNote?: { body: string; author?: string; essayId?: string; via?: "progress" | "full" | "counselor" | "coach"; byLink?: string; authorLevel?: ParentLevel };
  removeAdvisorNoteId?: string;
  /** Patch a single college by slug */
  collegePatch?: { slug: string } & Partial<Workspace["colleges"][number]>;
};

const LIST_BUDGETS = ["lt15", "15-30", "30-50", "50plus", "unsure"] as const;
const ED_CHOICES = ["yes", "no", "maybe"] as const;
const INCOME_BRACKETS = ["lt30", "30-48", "48-75", "75-110", "gt110", "unsure"] as const;
const CITIZENSHIP = ["us", "permanent", "international", "unsure"] as const;
const YES_NO_UNSURE = ["yes", "no", "unsure"] as const;

/** Writes SAT and its note to both stored copies (applicant and profile.testing), plus the ACT. Absent fields are kept. */
export function setTestScores(ws: Workspace, scores: { sat?: string; satNote?: string; act?: string }): Workspace {
  const sat = scores.sat !== undefined ? { sat: scores.sat } : {};
  const satNote = scores.satNote !== undefined ? { satNote: scores.satNote } : {};
  const act = scores.act !== undefined ? { act: scores.act } : {};
  return {
    ...ws,
    applicant: { ...ws.applicant, ...sat, ...satNote },
    profile: { ...ws.profile, testing: { ...ws.profile.testing, ...sat, ...satNote, ...act } },
  };
}

/**
 * Validates and normalizes the profile, applicant and list-preference parts of a patch. Other parts pass
 * through unchanged. mode "tool" treats "" and 0 as not provided (see lib/profile-fields.ts).
 */
export function checkWorkspacePatch(patch: WorkspacePatch, mode: WriteMode = "form"): Parsed<WorkspacePatch> {
  let next: WorkspacePatch = { ...patch };
  if (patch.advisorNote !== undefined) {
    // Only the server routes say where a note came from (share links, counselors), never a client patch.
    const { via: _via, byLink: _byLink, authorLevel: _level, ...note } = patch.advisorNote ?? { body: "" };
    next = { ...next, advisorNote: note };
  }
  if (patch.baseRevision !== undefined && !(Number.isSafeInteger(patch.baseRevision) && patch.baseRevision >= 0)) {
    return { ok: false, error: "baseRevision must be a whole number." };
  }
  if (patch.applicant !== undefined) {
    const parsed = parseApplicantFields(patch.applicant, mode);
    if (!parsed.ok) return parsed;
    next = { ...next, applicant: parsed.value };
  }
  if (patch.profile !== undefined) {
    const parsed = parseProfileFields(patch.profile, mode);
    if (!parsed.ok) return parsed;
    const { activities, honors, testing, ...rest } = parsed.value;
    next = {
      ...next,
      profile: {
        ...rest,
        ...(testing ? { testing: { ...testing, ...(testing.aps ? { aps: toAps(testing.aps) } : {}) } } : {}),
        ...(activities ? { activities: rankActivities(activities) } : {}),
        ...(honors ? { honors: toHonors(honors) } : {}),
      },
    };
  }
  const lp = patch.listPrefs as Record<string, unknown> | undefined;
  if (lp !== undefined) {
    if (!lp || typeof lp !== "object" || Array.isArray(lp)) return { ok: false, error: "listPrefs must be an object." };
    const blank = (v: unknown) => v === undefined || v === null || (mode === "tool" && v === "");
    if (!blank(lp.budget) && !(LIST_BUDGETS as readonly unknown[]).includes(lp.budget)) {
      return { ok: false, error: `Budget must be one of ${LIST_BUDGETS.join(", ")}.` };
    }
    if (!blank(lp.ed) && !(ED_CHOICES as readonly unknown[]).includes(lp.ed)) {
      return { ok: false, error: "Early Decision must be yes, no or maybe." };
    }
    for (const [key, allowed] of [["incomeBracket", INCOME_BRACKETS], ["citizenship", CITIZENSHIP], ["firstGen", YES_NO_UNSURE]] as const) {
      if (!blank(lp[key]) && !(allowed as readonly unknown[]).includes(lp[key])) return { ok: false, error: `${key} must be one of ${allowed.join(", ")}.` };
    }
    if (lp.needAid !== undefined && lp.needAid !== null && typeof lp.needAid !== "boolean") {
      return { ok: false, error: "needAid must be true or false." };
    }
    if (mode === "tool") {
      // Counts arrive from tools as text, so a 0 there is the student's answer, not a filled-in default.
      const kept = Object.entries(lp).filter(([k, v]) => !blank(v) && (v !== 0 || k === "suppCount" || k === "noSuppCount") && !(Array.isArray(v) && v.length === 0));
      next = { ...next, listPrefs: Object.fromEntries(kept) as Partial<OnboardingListPrefs> };
    }
  }
  if (patch.aidProfile !== undefined) {
    const parsed = parseAidProfile(patch.aidProfile, mode);
    if (!parsed.ok) return parsed;
    next = { ...next, aidProfile: parsed.value };
  }
  if (patch.recommendations !== undefined && patch.recommendations !== null) {
    const rows = patch.recommendations as unknown;
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
      return { ok: false, error: "recommendations must be a list of recommenders." };
    }
    for (const r of rows) {
      const problem = recExtrasError(r as Record<string, unknown>);
      if (problem) return { ok: false, error: problem };
    }
  }
  if (patch.recommendation) {
    const rec = patch.recommendation as Record<string, unknown>;
    if (typeof rec !== "object" || Array.isArray(rec)) return { ok: false, error: "recommendation must be an object." };
    const problem = recExtrasError(rec);
    if (problem) return { ok: false, error: problem };
  }
  if (patch.essayStatus !== undefined) {
    const parsed = checkEssayStatus(patch.essayStatus);
    if (!parsed.ok) return parsed;
  }
  if (patch.essaySuggestions !== undefined) {
    const parsed = checkEssaySuggestionDismissals(patch.essaySuggestions);
    if (!parsed.ok) return parsed;
  }
  if (patch.essayHidden !== undefined) {
    const parsed = checkEssayHidden(patch.essayHidden);
    if (!parsed.ok) return parsed;
  }
  if (patch.essayOption !== undefined) {
    const parsed = checkEssayOption(patch.essayOption);
    if (!parsed.ok) return parsed;
  }
  if (patch.essaySchools !== undefined) {
    const parsed = checkEssaySchools(patch.essaySchools);
    if (!parsed.ok) return parsed;
  }
  if (patch.commonAppPrompt !== undefined && patch.commonAppPrompt !== null && typeof patch.commonAppPrompt !== "string") {
    return { ok: false, error: "Choose one of the Common App personal essay prompts." };
  }
  const aid = checkAidPatch(next);
  if (!aid.ok) return aid;
  next = aid.value;
  return { ok: true, value: next };
}

/**
 * The checks that need the saved workspace: a chosen Common App prompt must be one of its prompts
 * (after any prompt replacement in the same patch). Null when the patch is fine.
 */
export function workspacePatchError(ws: Workspace, patch: WorkspacePatch): string | null {
  if (patch.commonAppPrompt === undefined || patch.commonAppPrompt === null) return null;
  const commonApp = patch.essays?.commonApp ?? ws.essays.commonApp;
  const checked = checkCommonAppPrompt(patch.commonAppPrompt, { ...ws, essays: { ...ws.essays, commonApp } });
  return checked.ok ? null : checked.error;
}

/** True when the patch replaces a whole profile list (activities, honors, AP scores or coursework). */
export function replacesProfileLists(patch: WorkspacePatch): boolean {
  const p = patch.profile;
  return Boolean(p && (Array.isArray(p.activities) || Array.isArray(p.honors) || Array.isArray(p.testing?.aps) || p.coursework));
}

/** A whole-list replacement made from an older revision would silently undo edits saved since. */
export function isStalePatch(ws: Workspace, patch: WorkspacePatch): boolean {
  return typeof patch.baseRevision === "number" && patch.baseRevision !== ws.revision && replacesProfileLists(patch);
}

const MAX_ADVISOR_NOTES = 500;

export function applyWorkspacePatch(ws: Workspace, patch: WorkspacePatch): Workspace {
  let next: Workspace = { ...ws };

  if (patch.listPrefs && typeof patch.listPrefs === "object") {
    const p = patch.listPrefs;
    const listPrefs: OnboardingListPrefs = {
      ambition: "balanced", settings: [], size: "any", regions: [], notes: "",
      ...next.onboarding.listPrefs,
    };
    if (["balanced", "ambitious", "conservative"].includes(p.ambition as string)) { listPrefs.ambition = p.ambition!; listPrefs.ambitionChosen = true; }
    const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(30, Math.round(v)) : null);
    const supp = count(p.suppCount), quick = count(p.noSuppCount);
    if (supp !== null) listPrefs.suppCount = supp;
    if (quick !== null) listPrefs.noSuppCount = quick;
    if (supp !== null || quick !== null) listPrefs.appCount = Math.max(1, (listPrefs.suppCount ?? 0) + (listPrefs.noSuppCount ?? 0));
    if (["small", "medium", "large", "any"].includes(p.size as string)) listPrefs.size = p.size!;
    if (Array.isArray(p.settings)) listPrefs.settings = [...new Set(p.settings.filter(s => ["urban", "suburban", "rural", "college-town", "any"].includes(s)))];
    if (Array.isArray(p.regions)) listPrefs.regions = [...new Set(p.regions.filter(r => ["northeast", "mid-atlantic", "south", "midwest", "west", "any"].includes(r)))];
    if (typeof p.notes === "string") listPrefs.notes = p.notes.trim().slice(0, 4000);
    if ((LIST_BUDGETS as readonly unknown[]).includes(p.budget)) listPrefs.budget = p.budget;
    if ((ED_CHOICES as readonly unknown[]).includes(p.ed)) listPrefs.ed = p.ed;
    if (typeof p.needAid === "boolean") listPrefs.needAid = p.needAid;
    // null is "not sure": the question goes back to unanswered.
    else if ((p as { needAid?: unknown }).needAid === null) delete listPrefs.needAid;
    if ((INCOME_BRACKETS as readonly unknown[]).includes(p.incomeBracket)) listPrefs.incomeBracket = p.incomeBracket;
    if ((CITIZENSHIP as readonly unknown[]).includes(p.citizenship)) listPrefs.citizenship = p.citizenship;
    if ((YES_NO_UNSURE as readonly unknown[]).includes(p.firstGen)) listPrefs.firstGen = p.firstGen;
    if (typeof p.countsRecommended === "boolean") listPrefs.countsRecommended = p.countsRecommended;
    if (supp !== null || quick !== null) { /* appCount follows the two counts */ }
    else if (p.appCount === null) listPrefs.appCount = null;
    else if (typeof p.appCount === "number" && Number.isFinite(p.appCount)) listPrefs.appCount = Math.max(1, Math.min(30, Math.round(p.appCount)));
    next = { ...next, onboarding: { ...next.onboarding, listPrefs } };
  }

  if (patch.applicant) {
    const { sat: _sat, satNote: _note, gpaByYear, ...rest } = patch.applicant;
    next = { ...next, applicant: assignDefined(next.applicant, rest as Record<string, unknown>) };
    // Years merge, so saving 11th grade keeps 9th and 10th; "—" clears one.
    if (gpaByYear) {
      const years = Object.fromEntries(Object.entries({ ...next.applicant.gpaByYear, ...gpaByYear }).filter(([, v]) => v && v !== "—"));
      next = { ...next, applicant: { ...next.applicant, gpaByYear: years } };
    }
  }

  if (patch.profile) {
    const p = patch.profile;
    next = {
      ...next,
      profile: {
        ...next.profile,
        ...(p.intended !== undefined ? { intended: p.intended } : {}),
        ...(p.switchTo !== undefined ? { switchTo: p.switchTo } : {}),
        ...(p.pathNote !== undefined ? { pathNote: p.pathNote } : {}),
        ...(p.hs !== undefined ? { hs: p.hs } : {}),
        ...(p.gradYear !== undefined ? { gradYear: p.gradYear } : {}),
        ...(p.location !== undefined ? { location: p.location } : {}),
        ...(p.counselor !== undefined ? { counselor: p.counselor } : {}),
        ...(p.residency !== undefined ? { residency: p.residency } : {}),
        testing: Array.isArray(p.testing?.aps) ? { ...next.profile.testing, aps: p.testing.aps } : next.profile.testing,
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

  // SAT lives in two places; every write updates both so readers never disagree.
  const t = patch.profile?.testing;
  const a = patch.applicant;
  const scores = {
    sat: t?.sat ?? a?.sat ?? undefined,
    satNote: t?.satNote ?? a?.satNote ?? undefined,
    act: t?.act ?? undefined,
  };
  if (scores.sat !== undefined || scores.satNote !== undefined || scores.act !== undefined) {
    next = setTestScores(next, scores);
  }

  if (patch.ed !== undefined) next = { ...next, ed: patch.ed };
  if (patch.criticalDates) next = { ...next, criticalDates: patch.criticalDates };
  if (patch.colleges) {
    next = syncEssaySupplements({ ...next, colleges: patch.colleges.map((c) => withWebLinks(c)) });
  }

  if (patch.essays) {
    next = {
      ...next,
      essays: {
        commonApp: patch.essays.commonApp ?? next.essays.commonApp,
        supplements: patch.essays.supplements
          ? mergeSupplements(next.essays.supplements, patch.essays.supplements)
          : next.essays.supplements,
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
  if (patch.essayStatus) next = applyEssayStatus(next, patch.essayStatus);
  if (patch.essayHidden) next = applyEssayHidden(next, patch.essayHidden);
  if (patch.essayOption) next = applyEssayOption(next, patch.essayOption);
  if (patch.essaySchools) next = applyEssaySchools(next, patch.essaySchools);
  if (patch.commonAppPrompt !== undefined) {
    // Only a valid choice is saved (route.ts refuses others with workspacePatchError first).
    const choice = checkCommonAppPrompt(patch.commonAppPrompt, next);
    if (choice.ok) next = applyCommonAppPrompt(next, choice.value);
  }
  if (patch.essaySuggestions) next = dismissSuggestions(next, patch.essaySuggestions);

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

  if (patch.recommendations) {
    const ids = trackedAppIds(next);
    next = { ...next, recommendations: patch.recommendations.map((r) => ({ ...withoutExtras(r), ...recExtras(r, undefined, ids) })) };
  }
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
      ...recExtras(r, existing, trackedAppIds(next)),
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

  if (patch.scholarships) next = { ...next, scholarships: mergeScholarshipList(next.scholarships, patch.scholarships) };
  if (patch.scholarship) {
    const s = patch.scholarship;
    const id = s.id || randomUUID().slice(0, 8);
    const existing = next.scholarships.find((x) => x.id === id);
    // "" clears the school link (lib/aid-validate.ts linkKind sets the kind to match).
    const slug = s.slug !== undefined ? s.slug : existing?.slug;
    const kind = linkKind(s, existing);
    const row: Scholarship = {
      id,
      name: s.name || existing?.name || "Scholarship",
      amount: s.amount ?? existing?.amount,
      deadline: s.deadline ?? existing?.deadline,
      status: s.status || existing?.status || "researching",
      url: s.url ?? existing?.url,
      notes: s.notes ?? existing?.notes,
      ...(slug ? { slug } : {}),
      ...(kind ? { kind } : {}),
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
  if (patch.aidProfile && typeof patch.aidProfile === "object") {
    next = { ...next, aidProfile: applyAidProfile(next.aidProfile, patch.aidProfile) };
  }

  if (patch.advisorNote?.body?.trim()) {
    const note: AdvisorNote = {
      id: randomUUID().slice(0, 10),
      body: patch.advisorNote.body.trim(),
      author: (patch.advisorNote.author || "Advisor").slice(0, 80),
      createdAt: Date.now(),
      essayId: patch.advisorNote.essayId,
      ...(patch.advisorNote.via ? { via: patch.advisorNote.via } : {}),
      ...(patch.advisorNote.byLink ? { byLink: patch.advisorNote.byLink } : {}),
      ...(patch.advisorNote.authorLevel ? { authorLevel: patch.advisorNote.authorLevel } : {}),
    };
    // Share links let anyone holding one write notes, so only the newest share-link notes are kept. Counselor and
    // coach notes are never trimmed, so link spam can't push them out.
    const all = [...next.advisorNotes, note];
    const fromLinks = all.filter((n) => !n.via || n.via === "full" || n.via === "progress");
    const drop = new Set(fromLinks.slice(0, Math.max(0, fromLinks.length - MAX_ADVISOR_NOTES)).map((n) => n.id));
    next = { ...next, advisorNotes: drop.size ? all.filter((n) => !drop.has(n.id)) : all };
  }
  if (patch.removeAdvisorNoteId) {
    next = {
      ...next,
      advisorNotes: next.advisorNotes.filter((n) => n.id !== patch.removeAdvisorNoteId),
    };
  }

  if (patch.collegePatch?.slug) {
    const { slug, ...fields } = withWebLinks(patch.collegePatch);
    next = {
      ...next,
      colleges: next.colleges.map((c) =>
        c.slug === slug ? { ...c, ...fields, slug: c.slug } : c
      ),
    };
  }

  return next;
}
