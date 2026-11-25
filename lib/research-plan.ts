/**
 * The live research steps run during onboarding: one school per step, in list order. Schools with a
 * curated file (lib/school-research) start from it, and the AI only fills what is missing or not current.
 */
import type { College, Essay, Workspace } from "./store";
import { loadSchoolResearch, type SchoolResearch } from "./school-research";
import { supplementsLookReal } from "./essay-supplements";
import { isUcCampus } from "./seed-college-list";

export const CURRENT_CYCLE = "2026-27";
export const MAX_ATTEMPTS = 3;
const PROMPT_BUDGET = 7_000;

export type ResearchStep = { slug: string; name: string; attempt: number; prompt: string };

/** Schools still to research, in list order: not complete and not given up on. */
export function researchQueue(ws: Workspace): College[] {
  return ws.colleges.filter((c) => !c.research?.complete && !c.research?.needsReview);
}

/** Records one finished step for a school; after MAX_ATTEMPTS incomplete steps it is marked for review. */
export function recordAttempt(ws: Workspace, slug: string): Workspace {
  return {
    ...ws,
    colleges: ws.colleges.map((c) => {
      if (c.slug !== slug || c.research?.complete) return c;
      const base = c.research ?? { slug: c.slug, name: c.name, checkedAt: new Date().toISOString().slice(0, 10), complete: false, facts: [], deadlines: [], supplements: [] };
      const attempts = (base.attempts ?? 0) + 1;
      return { ...c, research: { ...base, attempts, ...(attempts >= MAX_ATTEMPTS ? { needsReview: true } : {}) } };
    }),
  };
}

function curatedEssays(slug: string, name: string, r: SchoolResearch): Essay[] {
  return r.supplements
    .filter((p) => p.cycle === CURRENT_CYCLE)
    .map((p, i) => ({
      id: `${slug}-supp-${i + 1}`,
      group: name,
      label: p.label || `Prompt ${i + 1}`,
      prompt: p.prompt,
      limit: p.limit ?? 0,
      unit: p.unit ?? "words",
      starter: "",
      ...(p.required === false ? { required: false } : {}),
      source: "official" as const,
    }));
}

/**
 * Copies curated research into the list: facts onto each school, current-cycle deadlines when the school
 * has none, and current prompts when the school only has placeholders. Never overwrites the student's work.
 */
export function importCurated(ws: Workspace, load: (slug: string) => SchoolResearch | null = loadSchoolResearch): Workspace {
  let supplements = ws.essays.supplements;
  const colleges = ws.colleges.map((c) => {
    if (c.research?.facts.length) return c;
    const r = load(c.slug) ?? load(c.name);
    if (!r) return c;
    const deadlines = r.deadlines.filter((d) => d.cycle === CURRENT_CYCLE).map((d) => ({ plan: d.plan, date: d.date }));
    if (!isUcCampus(c) && !supplementsLookReal(supplements[c.slug])) {
      const essays = curatedEssays(c.slug, c.short || c.name, r);
      if (essays.length) supplements = { ...supplements, [c.slug]: essays };
    }
    // Curated files are a starting point: the step re-checks them, so complete waits for that.
    return {
      ...c,
      research: { ...r, slug: c.slug, complete: false },
      ...(!c.deadlines?.length && deadlines.length ? { deadlines } : {}),
    };
  });
  return { ...ws, colleges, essays: { ...ws.essays, supplements } };
}

function factLines(r: SchoolResearch | undefined): string {
  if (!r?.facts.length) return "";
  const lines = r.facts.map((f) => `- ${f.key}: ${f.value} [${f.cycle}${f.thirdParty ? ", third-party" : ""}; checked ${f.checkedAt}]`);
  const dl = (r.deadlines ?? []).map((d) => `- ${d.plan} ${d.date} [${d.cycle}]`);
  return [`Already on file (checked ${r.checkedAt}):`, ...lines, ...(dl.length ? ["Deadlines:", ...dl] : [])].join("\n");
}

/** The user message for one school's research step, kept under the chat's per-message limit. */
export function researchPrompt(c: College, ws: Workspace): string {
  const prefs = ws.onboarding.listPrefs;
  const known = factLines(c.research);
  const student = [
    ws.profile.intended && `intended major ${ws.profile.intended}`,
    ws.profile.residency && `resident of ${ws.profile.residency}`,
    prefs?.budget && `budget bucket ${prefs.budget}`,
    prefs?.needAid !== undefined && `need-based aid: ${prefs.needAid ? "yes" : "no"}`,
  ].filter(Boolean).join(", ");
  const task = known
    ? `Start from the facts on file. Re-verify deadlines and anything older than the ${CURRENT_CYCLE} cycle or marked third-party, and research every key that is missing.`
    : "Research every key from scratch.";
  const text = [
    `Research ${c.name} [${c.slug}] for this student (${student || "no profile details"}).`,
    task,
    "Keys: admit_rate, ed_admit_rate, sat_mid50, act_mid50, test_policy, meets_full_need, css_profile, merit_aid, net_price by income (net_price_lt30k, net_price_30_48k, net_price_48_75k, net_price_75_110k, net_price_gt110k), sticker_cost, ed_ea_options, interview, demonstrated_interest, major_notes (about their intended major), notes.",
    `Save: set_school_research (college "${c.slug}"), deadlines with upsert_college (slug "${c.slug}", deadlines [{plan, date}] for ${CURRENT_CYCLE}), verbatim prompts with set_essays (supplements {"${c.slug}": [...]}) unless the prompts on file are already current.`,
    known,
  ].filter(Boolean).join("\n\n");
  return text.length > PROMPT_BUDGET ? `${text.slice(0, PROMPT_BUDGET)}\n…` : text;
}

export function researchSteps(ws: Workspace): ResearchStep[] {
  return researchQueue(ws).map((c) => ({ slug: c.slug, name: c.short || c.name, attempt: (c.research?.attempts ?? 0) + 1, prompt: researchPrompt(c, ws) }));
}
