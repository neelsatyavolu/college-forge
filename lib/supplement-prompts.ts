/**
 * Scraped supplemental essay prompts for U.S. News top-250 national
 * universities and top-30 liberal arts colleges.
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
  /** Set when only some applicants answer it ("B.S.E Degree Applicants"). */
  audience?: string;
};

type ScrapedSchool = {
  name: string;
  scorecardId?: number;
  source: "official" | "collegevine" | "none";
  url?: string;
  cycle?: string | null;
  note?: string;
  prompts?: ScrapedPrompt[];
};

type ScrapedFile = { cycle: string; generatedAt: string; schools: Record<string, ScrapedSchool> };

/**
 * An Essay slot plus the structure the label and prompt text also spell out,
 * for the writing dashboard: whether it's required, who it's for, and the
 * options when the student answers one of several.
 */
export type ScrapedEssay = Essay & {
  required: boolean;
  audience?: string;
  options?: string[];
  /** How many of `options` to answer. */
  choose?: number;
  source: "official" | "collegevine";
  cycle: string | null;
};

// Via unknown: the JSON's inferred type shifts with each yearly refresh.
const FILE = data as unknown as ScrapedFile;

/** Shown when a school states no length limit (e.g. UChicago). */
const NO_LIMIT_WORDS = 650;

/** Loose name key, same idea as nameKey() in scripts/supplements/discover.mjs. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/--|—|–/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|at|of|in|main campus)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_SCORECARD_ID = new Map(
  Object.values(FILE.schools)
    .filter((s) => s.scorecardId)
    .map((s) => [s.scorecardId as number, s] as const)
);
const BY_NAME = new Map(Object.values(FILE.schools).map((s) => [nameKey(s.name || ""), s] as const));

type SchoolRef = Pick<College, "slug"> & Partial<Pick<College, "name" | "scorecardId">>;

/** A school's entry by slug, then Scorecard id, then name (Scorecard and U.S. News spell names differently). */
function schoolFor(college: SchoolRef): ScrapedSchool | undefined {
  return (
    FILE.schools[college.slug] ??
    (college.scorecardId ? BY_SCORECARD_ID.get(college.scorecardId) : undefined) ??
    (college.name ? BY_NAME.get(nameKey(college.name)) : undefined)
  );
}

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
  } else if (!school.cycle) {
    parts.push("(Cycle not stated on the school page; confirm on the school's site before writing.)");
  }
  return parts.filter(Boolean).join("\n\n");
}

function formatLabel(p: ScrapedPrompt): string {
  if (p.audience) return `${p.label} (only if this applies to you)`;
  return p.required ? p.label : `${p.label} (optional)`;
}

/** Scraped supplement slots for a college, or null when none are on file. */
export function scrapedSupplementsFor(college: College): ScrapedEssay[] | null {
  const school = schoolFor(college);
  if (!school || school.source === "none" || !school.prompts?.length) return null;
  const source = school.source;
  const group = shortName(college);
  return school.prompts.map((p, i) => ({
    id: `${college.slug}-supp-${i + 1}`,
    group,
    label: formatLabel(p),
    prompt: formatPrompt(p, school),
    limit: p.limit ?? NO_LIMIT_WORDS,
    unit: p.unit,
    starter: "",
    required: p.required,
    ...(p.audience ? { audience: p.audience } : {}),
    ...(p.options.length ? { options: p.options, choose: 1 } : {}),
    source,
    cycle: school.cycle ?? null,
  }));
}

/** True when the dataset records that a school has no supplemental essays. */
export function knownNoSupplements(college: string | SchoolRef): boolean {
  return schoolFor(typeof college === "string" ? { slug: college } : college)?.source === "none";
}
