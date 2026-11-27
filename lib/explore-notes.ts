/**
 * What Explore shows from Forge's audited research files (lib/school-research/<slug>.json):
 * filter flags derived from the facts, and the sourced notes the school page lists.
 */
import { loadSchoolResearch, type ResearchKey, type SchoolResearch } from "./school-research";

export type TestPolicy = "required" | "optional" | "blind";
export type Interest = "very-important" | "important" | "considered" | "not-considered";

export type ResearchFlags = {
  meetsNeed?: boolean;
  testPolicy?: TestPolicy;
  merit?: boolean;
  ed?: boolean;
  ea?: boolean;
  interview?: boolean;
  interest?: Interest;
};

const fact = (r: SchoolResearch, key: ResearchKey) => r.facts.find((f) => f.key === key)?.value ?? "";

/** "Yes: 100% of need met…" or "meets full demonstrated need" → true; "No; 88% of need met" → false. */
export function meetsFullNeed(text: string): boolean | undefined {
  if (!text) return undefined;
  if (/^\s*(no\b|not\b|does not)/i.test(text)) return false;
  return /full (demonstrated )?need|100% of (demonstrated |calculated )?need/i.test(text) ? true : undefined;
}

export function testPolicyOf(text: string): TestPolicy | undefined {
  if (!text) return undefined;
  if (/test[- ](blind|free)|does not (consider|accept) (test )?scores/i.test(text)) return "blind";
  if (/test[- ]optional|optional/i.test(text)) return "optional";
  if (/required|test[- ]required/i.test(text)) return "required";
  return undefined;
}

export function meritOf(text: string): boolean | undefined {
  if (!text) return undefined;
  if (/^\s*(no\b|none\b|essentially none|not offered)/i.test(text)) return false;
  if (/^\s*yes\b/i.test(text)) return true;
  return undefined;
}

export function interestOf(text: string): Interest | undefined {
  const t = text.toLowerCase();
  if (t.startsWith("very important")) return "very-important";
  if (t.startsWith("important")) return "important";
  if (t.startsWith("considered")) return "considered";
  if (t.startsWith("not considered")) return "not-considered";
  return undefined;
}

export function interviewOffered(text: string): boolean | undefined {
  if (!text) return undefined;
  if (/^\s*(not considered|no interview|none|not offered|no\b)/i.test(text)) return false;
  return /interview/i.test(text) ? true : undefined;
}

export function roundsOf(text: string): { ed?: boolean; ea?: boolean } {
  if (!text) return {};
  const noEd = /\bno (ED|early decision)\b/i.test(text);
  const noEa = /\bno (EA|early action)\b|no EA or/i.test(text);
  return {
    ed: !noEd && /\bED( ?I+)?\b|early decision/i.test(text),
    ea: !noEa && /\b(R?EA|SCEA)\b|early action/i.test(text),
  };
}

export function researchFlags(r: SchoolResearch | null): ResearchFlags {
  if (!r) return {};
  const flags: ResearchFlags = {
    meetsNeed: meetsFullNeed(fact(r, "meets_full_need")),
    testPolicy: testPolicyOf(fact(r, "test_policy")),
    merit: meritOf(fact(r, "merit_aid")),
    interview: interviewOffered(fact(r, "interview")),
    interest: interestOf(fact(r, "demonstrated_interest")),
    ...roundsOf(fact(r, "ed_ea_options")),
  };
  return Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined)) as ResearchFlags;
}

/** Labels for the school page, in reading order. Net-price bands go in their own table. */
export const NOTE_LABELS: Partial<Record<ResearchKey, string>> = {
  admit_rate: "Admit rate",
  ed_admit_rate: "Early admit rate",
  ed_ea_options: "Application rounds",
  sat_mid50: "SAT middle 50%",
  act_mid50: "ACT middle 50%",
  gpa_note: "GPA",
  test_policy: "Testing policy",
  interview: "Interview",
  demonstrated_interest: "Demonstrated interest",
  major_notes: "Majors & programs",
  meets_full_need: "Need-based aid",
  css_profile: "Aid forms",
  merit_aid: "Merit scholarships",
  sticker_cost: "Sticker price",
  notes: "Good to know",
};

export const INCOME_BANDS: [ResearchKey, string][] = [
  ["net_price_lt30k", "Under $30,000"],
  ["net_price_30_48k", "$30,000–48,000"],
  ["net_price_48_75k", "$48,000–75,000"],
  ["net_price_75_110k", "$75,000–110,000"],
  ["net_price_gt110k", "Over $110,000"],
];

export type ExploreNote = { label: string; value: string; sourceUrl: string; checkedAt: string; thirdParty: boolean };

/** The sourced notes, net price by income, deadlines and essay prompts for one school. */
export function exploreNotes(slug: string) {
  const r = loadSchoolResearch(slug);
  if (!r) return null;
  const notes: ExploreNote[] = [];
  for (const [key, label] of Object.entries(NOTE_LABELS) as [ResearchKey, string][]) {
    for (const f of r.facts.filter((x) => x.key === key)) {
      notes.push({ label, value: f.value, sourceUrl: f.sourceUrl, checkedAt: f.checkedAt, thirdParty: f.thirdParty });
    }
  }
  const byIncome = INCOME_BANDS.flatMap(([key, band]) => {
    const f = r.facts.find((x) => x.key === key);
    return f ? [{ band, value: f.value, sourceUrl: f.sourceUrl }] : [];
  });
  return {
    checkedAt: r.checkedAt,
    notes,
    byIncome,
    deadlines: r.deadlines.map((d) => ({ plan: d.plan, date: d.date, note: d.note, sourceUrl: d.sourceUrl })),
    essays: r.supplements.map((p) => ({ label: p.label, prompt: p.prompt, limit: p.limit, unit: p.unit, required: p.required, sourceUrl: p.sourceUrl })),
  };
}

export function researchFlagsFor(slug: string): ResearchFlags {
  return researchFlags(loadSchoolResearch(slug));
}
