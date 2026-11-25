/**
 * Audited per-school research files (lib/school-research/<slug>.json) for the US News top 100
 * national universities and top 50 liberal arts colleges. The onboarding research step reads a
 * school's file first and only searches the web for facts that are missing or stale.
 */
import fs from "node:fs";
import path from "node:path";
import { slugify } from "./colleges";

export const RESEARCH_KEYS = [
  "admit_rate",
  "ed_admit_rate",
  "sat_mid50",
  "act_mid50",
  "gpa_note",
  "test_policy",
  "meets_full_need",
  "css_profile",
  "merit_aid",
  "net_price_lt30k",
  "net_price_30_48k",
  "net_price_48_75k",
  "net_price_75_110k",
  "net_price_gt110k",
  "sticker_cost",
  "ed_ea_options",
  "interview",
  "demonstrated_interest",
  "major_notes",
  "notes",
] as const;
export type ResearchKey = (typeof RESEARCH_KEYS)[number];

export type ResearchFact = {
  key: ResearchKey;
  value: string;
  sourceUrl: string;
  /** yyyy-mm-dd the source was read. */
  checkedAt: string;
  /** Admissions cycle the fact describes, e.g. "2026-27" (current) or "2025-26". */
  cycle: string;
  /** True when the source is not the school's own site or a government/CDS document. */
  thirdParty: boolean;
};

export type ResearchDeadline = { plan: string; date: string; sourceUrl: string; cycle: string; note?: string };
export type ResearchPrompt = { label: string; prompt: string; limit?: number; unit?: "words" | "characters"; required?: boolean; sourceUrl: string; cycle: string; thirdParty?: boolean };

export type SchoolResearch = {
  slug: string;
  name: string;
  checkedAt: string;
  /** Every required key researched (a fact or an explicit "not published" note). */
  complete: boolean;
  facts: ResearchFact[];
  deadlines: ResearchDeadline[];
  supplements: ResearchPrompt[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CYCLE = /^\d{4}-\d{2}$/;
const httpsUrl = (s: unknown) => typeof s === "string" && /^https?:\/\/[^\s]+\.[^\s]+/.test(s);

/** Problems with one research file; empty when it is valid. */
export function validateSchoolResearch(r: unknown): string[] {
  const errs: string[] = [];
  const o = (r ?? {}) as Partial<SchoolResearch>;
  if (!o.slug || typeof o.slug !== "string") errs.push("slug missing");
  if (!o.name || typeof o.name !== "string") errs.push("name missing");
  if (!DATE.test(String(o.checkedAt))) errs.push("checkedAt not yyyy-mm-dd");
  if (typeof o.complete !== "boolean") errs.push("complete not boolean");
  for (const [i, f] of (Array.isArray(o.facts) ? o.facts : []).entries()) {
    if (!RESEARCH_KEYS.includes(f.key)) errs.push(`facts[${i}] unknown key ${f.key}`);
    if (!f.value || typeof f.value !== "string") errs.push(`facts[${i}] empty value`);
    if (!httpsUrl(f.sourceUrl)) errs.push(`facts[${i}] bad sourceUrl`);
    if (!DATE.test(String(f.checkedAt))) errs.push(`facts[${i}] bad checkedAt`);
    if (!CYCLE.test(String(f.cycle))) errs.push(`facts[${i}] bad cycle`);
    if (typeof f.thirdParty !== "boolean") errs.push(`facts[${i}] thirdParty not boolean`);
  }
  if (!Array.isArray(o.facts)) errs.push("facts not an array");
  for (const [i, d] of (Array.isArray(o.deadlines) ? o.deadlines : []).entries()) {
    if (!d.plan) errs.push(`deadlines[${i}] plan missing`);
    if (!DATE.test(String(d.date))) errs.push(`deadlines[${i}] bad date`);
    if (!httpsUrl(d.sourceUrl)) errs.push(`deadlines[${i}] bad sourceUrl`);
    if (!CYCLE.test(String(d.cycle))) errs.push(`deadlines[${i}] bad cycle`);
  }
  if (!Array.isArray(o.deadlines)) errs.push("deadlines not an array");
  for (const [i, p] of (Array.isArray(o.supplements) ? o.supplements : []).entries()) {
    if (!p.prompt || typeof p.prompt !== "string") errs.push(`supplements[${i}] prompt missing`);
    if (!httpsUrl(p.sourceUrl)) errs.push(`supplements[${i}] bad sourceUrl`);
    if (!CYCLE.test(String(p.cycle))) errs.push(`supplements[${i}] bad cycle`);
  }
  if (!Array.isArray(o.supplements)) errs.push("supplements not an array");
  const blob = JSON.stringify(r);
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(blob)) errs.push("contains an email address");
  return errs;
}

const DIR = path.join(process.cwd(), "lib", "school-research");
let index: Map<string, string> | null = null;

function researchIndex(): Map<string, string> {
  if (index) return index;
  index = new Map();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8")) as { schools: { slug: string; name: string }[] };
    for (const s of manifest.schools) {
      index.set(s.slug, s.slug);
      index.set(slugify(s.name), s.slug);
    }
  } catch {
    // no manifest: no curated research
  }
  return index;
}

/** The curated research for a school (by slug or name), or null when none is on file or it is invalid. */
export function loadSchoolResearch(slugOrName: string): SchoolResearch | null {
  const key = researchIndex().get(slugOrName) ?? researchIndex().get(slugify(slugOrName));
  if (!key) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DIR, `${key}.json`), "utf8"));
    return validateSchoolResearch(parsed).length ? null : (parsed as SchoolResearch);
  } catch {
    return null;
  }
}
