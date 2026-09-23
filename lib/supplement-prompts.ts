/**
 * Scraped supplemental essay prompts for U.S. News top-250 schools.
 *
 * Data comes from scripts/fetch-supplements.mjs (official admissions pages,
 * CollegeVine fallback), refreshed yearly by the refresh-supplements GitHub
 * workflow. This module turns a school's entry into Essay slots.
 */

import data from "./supplements/prompts.json";
import type { College, Essay } from "./store";

type ScrapedPrompt = {
  label: string;
  prompt: string;
  limit: number | null;
  unit: string;
  required: boolean;
  options: string[];
};

type ScrapedSchool = {
  name: string;
  source: "official" | "collegevine" | "none";
  url?: string;
  cycle?: string | null;
  note?: string;
  prompts?: ScrapedPrompt[];
};

type ScrapedFile = { cycle: string; generatedAt: string; schools: Record<string, ScrapedSchool> };

// Via unknown: the JSON's inferred type shifts with each yearly refresh.
const FILE = data as unknown as ScrapedFile;

/** Shown when a school states no length limit (e.g. UChicago). */
const NO_LIMIT_WORDS = 650;

function shortName(c: College): string {
  return (c.short || c.name || c.slug || "School").trim();
}

function formatPrompt(p: ScrapedPrompt, school: ScrapedSchool): string {
  const parts = [p.prompt.trim()];
  if (p.options.length) {
    parts.push(p.options.map((o, i) => `Option ${i + 1}: ${o.trim()}`).join("\n\n"));
  }
  if (p.limit == null) {
    parts.push(`(No official length limit; ${NO_LIMIT_WORDS} words shown as a guide.)`);
  }
  const outdated = school.cycle && school.cycle !== FILE.cycle;
  if (school.source === "collegevine" || outdated) {
    const cycle = school.cycle ? `${school.cycle} prompts` : "Prompts";
    const via = school.source === "collegevine" ? " via CollegeVine" : "";
    parts.push(`(${cycle}${via}; confirm on the school's site before writing.)`);
  }
  return parts.filter(Boolean).join("\n\n");
}

/** Scraped supplement slots for a college, or null when none are on file. */
export function scrapedSupplementsFor(college: College): Essay[] | null {
  const school = FILE.schools[college.slug];
  if (!school || school.source === "none" || !school.prompts?.length) return null;
  const group = shortName(college);
  return school.prompts.map((p, i) => ({
    id: `${college.slug}-supp-${i + 1}`,
    group,
    label: p.required ? p.label : `${p.label} (optional)`,
    prompt: formatPrompt(p, school),
    limit: p.limit ?? NO_LIMIT_WORDS,
    unit: p.unit,
    starter: "",
  }));
}

/** True when the dataset records that a school has no supplemental essays. */
export function knownNoSupplements(slug: string): boolean {
  return FILE.schools[slug]?.source === "none";
}
