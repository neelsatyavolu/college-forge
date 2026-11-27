/**
 * Facts about a college for one student, from Forge's audited research files: what it would cost
 * their family, and whether its application needs supplemental essays. Used to fill the draft list
 * so these come from data, not the AI's guess.
 */
import type { IncomeBracket, OnboardingListPrefs, Workspace } from "./store";
import { loadSchoolResearch, type SchoolResearch } from "./school-research";
import { averageNetPrice, schoolPlace } from "./college-recommendations";
import { internationalAid, internationalAidLabel } from "./international-aid";

export const CURRENT_CYCLE = "2026-27";

const BRACKET_KEY: Record<Exclude<IncomeBracket, "unsure">, string> = {
  lt30: "net_price_lt30k",
  "30-48": "net_price_30_48k",
  "48-75": "net_price_48_75k",
  "75-110": "net_price_75_110k",
  gt110: "net_price_gt110k",
};

/** Yearly budget caps by bucket; null means cost isn't a constraint. */
export const BUDGET_CAP: Record<string, number | null> = { lt15: 15_000, "15-30": 30_000, "30-50": 50_000, "50plus": null, unsure: null };

const NO_SUPPLEMENTS = /no (school-specific |written |writing |required |additional )?supplement|no supplemental|does not require (a |any )?supplement|no additional essay/i;

/** The first dollar amount in a fact's value ("$27,982 (2023-24)" -> 27982); "$0 (...)" -> 0. */
export function dollars(value: string): number | null {
  const m = /\$\s?([\d,]+)/.exec(value);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

export type NetPrice = { amount: number; basis: "income" | "sticker" | "average"; label: string };

/** Federal net price by income counts in-state students only, so it isn't a nonresident's price at a public. */
export function outOfStatePublic(place: { state: string; isPublic: boolean } | null, residency: string | undefined): boolean {
  return !!place && place.isPublic && !!residency && /^[A-Z]{2}$/.test(residency) && place.state !== residency;
}

/**
 * What a year would likely cost this family: the average net price for their income bracket, or the
 * full cost of attendance when they won't apply for need-based aid. Null when Forge has no data.
 */
export function netPriceFor(research: SchoolResearch | null, prefs: OnboardingListPrefs | undefined): NetPrice | null {
  if (!research) return null;
  const fact = (key: string) => research.facts.find((f) => f.key === key);
  if (prefs?.needAid === false) {
    const sticker = fact("sticker_cost");
    const amount = sticker ? dollars(sticker.value) : null;
    return amount !== null ? { amount, basis: "sticker", label: `$${amount.toLocaleString("en-US")} full cost (no need-based aid)` } : null;
  }
  const bracket = prefs?.incomeBracket;
  if (!bracket || bracket === "unsure") return null;
  const f = fact(BRACKET_KEY[bracket]);
  const amount = f ? dollars(f.value) : null;
  return amount !== null ? { amount, basis: "income", label: `$${amount.toLocaleString("en-US")} average for your income` } : null;
}

/** "yes" when current prompts are on file, "no" when a sourced note says there are none, else null. */
export function supplementsFor(research: SchoolResearch | null): "yes" | "no" | null {
  if (!research) return null;
  if (research.supplements.some((p) => p.cycle === CURRENT_CYCLE)) return "yes";
  if (research.facts.some((f) => f.key === "notes" && NO_SUPPLEMENTS.test(f.value))) return "no";
  return null;
}

export type StudentFacts = { netPrice: NetPrice | null; fitsBudget: "yes" | "no" | null; supplements: "yes" | "no" | null; outOfState?: boolean; international?: boolean };

export function studentFacts(ws: Workspace, nameOrSlug: string, slug?: string): StudentFacts {
  const research = loadSchoolResearch(slug || nameOrSlug) ?? loadSchoolResearch(nameOrSlug);
  const prefs = ws.onboarding.listPrefs;
  const residency = (ws.profile.residency || "").trim().toUpperCase();
  // Federal net-price data covers US students only; international aid works differently at every college.
  if (prefs?.citizenship === "international") {
    const sticker = research?.facts.find((f) => f.key === "sticker_cost");
    const amount = sticker ? dollars(sticker.value) : null;
    const noCap = !prefs.budget || BUDGET_CAP[prefs.budget] === null;
    const aidNote = internationalAidLabel(internationalAid(research?.slug ?? slug ?? nameOrSlug));
    return {
      netPrice: amount !== null ? { amount, basis: "sticker", label: `$${amount.toLocaleString("en-US")} full cost before any aid for international students${aidNote ? `; ${aidNote}` : ""}` } : null,
      fitsBudget: noCap ? (prefs.budget ? "yes" : null) : amount !== null && amount <= (BUDGET_CAP[prefs.budget!] ?? Infinity) ? "yes" : null,
      supplements: supplementsFor(research), international: true,
    };
  }
  if (outOfStatePublic(schoolPlace(nameOrSlug, slug), residency) && prefs?.needAid !== false) {
    // The income-bracket average is for residents; a nonresident usually pays much more at a public.
    const noCap = !!prefs?.budget && BUDGET_CAP[prefs.budget] === null;
    return { netPrice: null, fitsBudget: noCap ? "yes" : null, supplements: supplementsFor(research), outOfState: true };
  }
  // Without a research file, the federal all-incomes average is the best guide; it says so.
  const avg = !research && prefs?.needAid !== false ? averageNetPrice(nameOrSlug, slug) : null;
  const netPrice = netPriceFor(research, prefs) ?? (avg !== null ? { amount: avg, basis: "average" as const, label: `$${avg.toLocaleString("en-US")} average net price, all incomes` } : null);
  const cap = prefs?.budget ? BUDGET_CAP[prefs.budget] ?? null : null;
  const fitsBudget = netPrice && cap !== null ? (netPrice.amount <= cap ? "yes" : "no") : cap === null && prefs?.budget ? "yes" : null;
  return { netPrice, fitsBudget, supplements: supplementsFor(research) };
}
