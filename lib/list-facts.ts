/**
 * Facts about a college for one student, from Forge's audited research files: what it would cost
 * their family, and whether its application needs supplemental essays. Used to fill the draft list
 * so these come from data, not the AI's guess.
 */
import type { IncomeBracket, OnboardingListPrefs, Workspace } from "./store";
import { loadSchoolResearch, type SchoolResearch } from "./school-research";

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

export type NetPrice = { amount: number; basis: "income" | "sticker"; label: string };

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

export type StudentFacts = { netPrice: NetPrice | null; fitsBudget: "yes" | "no" | null; supplements: "yes" | "no" | null };

export function studentFacts(ws: Workspace, nameOrSlug: string): StudentFacts {
  const research = loadSchoolResearch(nameOrSlug);
  const prefs = ws.onboarding.listPrefs;
  const netPrice = netPriceFor(research, prefs);
  const cap = prefs?.budget ? BUDGET_CAP[prefs.budget] ?? null : null;
  const fitsBudget = netPrice && cap !== null ? (netPrice.amount <= cap ? "yes" : "no") : cap === null && prefs?.budget ? "yes" : null;
  return { netPrice, fitsBudget, supplements: supplementsFor(research) };
}
