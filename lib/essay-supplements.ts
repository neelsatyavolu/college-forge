/**
 * Keep Essays.supplements in sync with the college shortlist.
 *
 * When schools are added (onboarding seed, upsert_college, Explore add),
 * ensure each application has a sidebar group with starter prompts:
 *   - UC campuses → one shared "UC Application" PIQ set (pick 4 of 8)
 *   - schools in the scraped dataset (lib/supplement-prompts.ts) → their prompts
 *   - schools recorded as having no supplements → no group
 *   - everyone else → placeholder "Why us" / short-answer slots the copilot
 *     should replace with real current-cycle prompts via set_essays
 *
 * Existing prompts and drafts are never overwritten — only missing keys
 * get seeded. Existing placeholder groups are not swapped for scraped
 * prompts: this runs on every read, before a patch's drafts are applied, so
 * a first draft saved against a placeholder id would be orphaned. Orphan
 * keys (schools removed from the list) are left alone so drafts aren't
 * deleted.
 */

import type { College, Essay, Workspace } from "./store";
import { isUcCampus } from "./seed-college-list";
import { knownNoSupplements, scrapedSupplementsFor } from "./supplement-prompts";

/** Synthetic slug for the shared UC Application essay set. */
export const UC_APPLICATION_SLUG = "uc-application";

/**
 * Official UC Personal Insight Questions (350 words each; student answers 4 of 8).
 * Prompts are stable year-to-year; word limit confirmed via UC admissions.
 */
export const UC_PERSONAL_INSIGHT_QUESTIONS: Essay[] = [
  {
    id: "uc-piq-1",
    group: "UC Application",
    label: "PIQ 1 — Leadership",
    prompt:
      "Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes, or contributed to group efforts over time.",
    limit: 350,
    unit: "words",
    starter: "",
  },
  {
    id: "uc-piq-2",
    group: "UC Application",
    label: "PIQ 2 — Creative side",
    prompt:
      "Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. Describe how you express your creative side.",
    limit: 350,
    unit: "words",
    starter: "",
  },
  {
    id: "uc-piq-3",
    group: "UC Application",
    label: "PIQ 3 — Greatest talent or skill",
    prompt:
      "What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time?",
    limit: 350,
    unit: "words",
    starter: "",
  },
  {
    id: "uc-piq-4",
    group: "UC Application",
    label: "PIQ 4 — Educational opportunity or barrier",
    prompt:
      "Describe how you have taken advantage of a significant educational opportunity or worked to overcome an educational barrier you have faced.",
    limit: 350,
    unit: "words",
    starter: "",
  },
  {
    id: "uc-piq-5",
    group: "UC Application",
    label: "PIQ 5 — Significant challenge",
    prompt:
      "Describe the most significant challenge you have faced and the steps you have taken to overcome this challenge. How has this challenge affected your academic achievement?",
    limit: 350,
    unit: "words",
    starter: "",
  },
  {
    id: "uc-piq-6",
    group: "UC Application",
    label: "PIQ 6 — Academic subject",
    prompt:
      "Think about an academic subject that inspires you. Describe how you have furthered this interest inside and/or outside of the classroom.",
    limit: 350,
    unit: "words",
    starter: "",
  },
  {
    id: "uc-piq-7",
    group: "UC Application",
    label: "PIQ 7 — Community",
    prompt:
      "What have you done to make your school or your community a better place?",
    limit: 350,
    unit: "words",
    starter: "",
  },
  {
    id: "uc-piq-8",
    group: "UC Application",
    label: "PIQ 8 — Strong candidate",
    prompt:
      "Beyond what has already been shared in your application, what do you believe makes you a strong candidate for admissions to the University of California?",
    limit: 350,
    unit: "words",
    starter: "",
  },
];

function shortName(c: College): string {
  return (c.short || c.name || c.slug || "School").trim();
}

/**
 * Minimal placeholder slots for a non-UC school until the copilot loads
 * real current-cycle prompts. Ids are stable per slug so drafts stick
 * if the copilot later upgrades labels/prompts in place.
 */
export function placeholderSupplementsForCollege(c: College): Essay[] {
  const slug = c.slug || "school";
  const name = shortName(c);
  return [
    {
      id: `${slug}-why-us`,
      group: name,
      label: "Why us / school essay",
      prompt:
        `Supplemental prompt for ${c.name || name} is not loaded yet. Ask the copilot to look up this school's current-cycle supplemental essay prompts (and short answers) and update the Essays tab.`,
      limit: 650,
      unit: "words",
      starter: "",
    },
    {
      id: `${slug}-short`,
      group: name,
      label: "Short answer / other",
      prompt:
        `Optional second slot for ${name} (community, major, activity, or other short prompts). Copilot will replace this with real prompts when available.`,
      limit: 250,
      unit: "words",
      starter: "",
    },
  ];
}

function hasRealPrompts(essays: Essay[] | undefined): boolean {
  if (!essays || essays.length === 0) return false;
  // Placeholders mention "not loaded yet" / "Copilot will replace"
  const placeholderish = essays.every(
    (e) =>
      /not loaded yet/i.test(e.prompt || "") ||
      /copilot will replace/i.test(e.prompt || "") ||
      /ask the copilot to look up/i.test(e.prompt || "")
  );
  return !placeholderish;
}

/**
 * Ensure essays.supplements has an entry for every school (or shared UC app)
 * currently on the list. Does not clobber non-empty real prompts.
 */
export function syncEssaySupplements(ws: Workspace): Workspace {
  const colleges = ws.colleges || [];
  const prev = ws.essays?.supplements || {};
  const next: Record<string, Essay[]> = { ...prev };
  let changed = false;

  const ucs = colleges.filter(isUcCampus);
  const nonUc = colleges.filter((c) => !isUcCampus(c));

  if (ucs.length > 0) {
    const existing = next[UC_APPLICATION_SLUG];
    if (!existing || existing.length === 0) {
      next[UC_APPLICATION_SLUG] = UC_PERSONAL_INSIGHT_QUESTIONS.map((e) => ({ ...e }));
      changed = true;
    }
    // Do not invent per-campus UC supplement groups — PIQs are shared.
  }

  for (const c of nonUc) {
    const slug = c.slug;
    if (!slug) continue;
    const existing = next[slug];
    if (!existing || existing.length === 0) {
      const scraped = scrapedSupplementsFor(c);
      if (!scraped && (knownNoSupplements(slug) || c.supp === "No supps")) continue;
      next[slug] = scraped ?? placeholderSupplementsForCollege(c);
      changed = true;
    }
  }

  if (!changed) return ws;

  return {
    ...ws,
    essays: {
      commonApp: ws.essays?.commonApp || [],
      supplements: next,
    },
  };
}

/**
 * Merge AI-provided supplement maps by college slug (partial updates
 * must not wipe other schools). Empty array for a slug clears that slug.
 */
export function mergeSupplements(
  current: Record<string, Essay[]>,
  incoming: Record<string, Essay[]>
): Record<string, Essay[]> {
  const out: Record<string, Essay[]> = { ...current };
  for (const [slug, essays] of Object.entries(incoming)) {
    if (!Array.isArray(essays)) continue;
    if (essays.length === 0) {
      delete out[slug];
    } else {
      out[slug] = essays;
    }
  }
  return out;
}

/** True when a slug's prompts look like real (non-placeholder) content. */
export function supplementsLookReal(essays: Essay[] | undefined): boolean {
  return hasRealPrompts(essays);
}
