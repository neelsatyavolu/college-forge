/**
 * An approximate financial-aid picture for one student, built only from what they told Forge: the federal
 * Student Aid Index (lib/sai-formula.ts, the official 2027-28 formula), Pell Grant eligibility, and per school on
 * their list the need (cost of attendance minus SAI) and a likely net price.
 *
 * Always an estimate. Most inputs are ranges, so every number is computed at the low and the high end of what the
 * student gave and shown as a range rounded to $100. Each estimate lists the assumptions it made.
 * Read-only and derived on request: nothing here is stored.
 */
import type { College, IncomeBracket, Workspace } from "./store";
import type { AidProfile } from "./aid-profile";
import { loadSchoolResearch, type SchoolResearch } from "./school-research";
import { BUDGET_CAP, dollars, outOfStatePublic } from "./list-facts";
import { schoolPlace } from "./college-recommendations";
import { MAX_PELL, SAI_AWARD_YEAR, SAI_GUIDE_URL, formulaA, pellFor, type FilingStatus } from "./sai-formula";

export type Range = { low: number; high: number };
export type SaiEstimate = {
  status: "ok" | "needs_income" | "independent" | "not_applying";
  awardYear: string;
  sai: Range | null;
  pell: { eligible: "yes" | "maybe" | "no"; amount: Range } | null;
  assumptions: string[];
  source: string;
};
export type SchoolAidEstimate = {
  slug: string;
  name: string;
  /** Cost of attendance for a year, from the school's research file. */
  coa: number | null;
  /** COA minus SAI (never below 0). */
  need: Range | null;
  netPrice: Range | null;
  basis: "full_need" | "school_average" | "nonresident" | "none";
  fitsBudget: "yes" | "no" | "maybe" | null;
  note: string;
};
export type AidEstimate = SaiEstimate & { schools: SchoolAidEstimate[]; budgetCap: number | null };

const K = 1_000;
/** Range bounds in dollars for each answer. Open-ended top ranges use a stated ceiling. */
const PARENT_ASSETS: Record<string, [number, number]> = { lt10: [0, 10 * K], "10-50": [10 * K, 50 * K], "50-100": [50 * K, 100 * K], "100-250": [100 * K, 250 * K], "250-500": [250 * K, 500 * K], gt500: [500 * K, 1_000 * K] };
const STUDENT_INCOME: Record<string, [number, number]> = { lt5: [0, 5 * K], "5-12": [5 * K, 12 * K], "12-20": [12 * K, 20 * K], gt20: [20 * K, 30 * K] };
const STUDENT_SAVINGS: Record<string, [number, number]> = { lt1: [0, 1 * K], "1-5": [1 * K, 5 * K], "5-15": [5 * K, 15 * K], gt15: [15 * K, 30 * K] };
const INCOME_BRACKET: Record<Exclude<IncomeBracket, "unsure">, [number, number]> = { lt30: [10 * K, 30 * K], "30-48": [30 * K, 48 * K], "48-75": [48 * K, 75 * K], "75-110": [75 * K, 110 * K], gt110: [110 * K, 200 * K] };
const NET_PRICE_KEY: [number, string][] = [[30 * K, "net_price_lt30k"], [48 * K, "net_price_30_48k"], [75 * K, "net_price_48_75k"], [110 * K, "net_price_75_110k"], [Infinity, "net_price_gt110k"]];

/**
 * APPROXIMATION: 2025 federal income tax on wage income with the standard deduction (MFJ $31,500, head of
 * household $23,625, single $15,750) and the 2025 brackets, less $500 per dependent (credit for other
 * dependents). Real returns differ (other credits, itemizing); the FAFSA reads the actual figure from the IRS.
 */
const BRACKETS: Record<"mfj" | "hoh" | "single", { deduction: number; tops: number[] }> = {
  mfj: { deduction: 31_500, tops: [23_850, 96_950, 206_700, 394_600, 501_050, 751_600, Infinity] },
  hoh: { deduction: 23_625, tops: [17_000, 64_850, 103_350, 197_300, 250_500, 626_350, Infinity] },
  single: { deduction: 15_750, tops: [11_925, 48_475, 103_350, 197_300, 250_525, 626_350, Infinity] },
};
const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
export function estimateIncomeTax(agi: number, status: "mfj" | "hoh" | "single", dependents = 0): number {
  const { deduction, tops } = BRACKETS[status];
  let taxable = Math.max(0, agi - deduction);
  let tax = 0;
  let floor = 0;
  for (let i = 0; i < tops.length && taxable > 0; i++) {
    const slice = Math.min(taxable, tops[i] - floor);
    tax += slice * RATES[i];
    taxable -= slice;
    floor = tops[i];
  }
  return Math.max(0, Math.round(tax - 500 * dependents));
}

const to100 = (n: number) => (n <= -1_500 ? -1_500 : Math.round(n / 100) * 100);
const span = (a: number, b: number): Range => ({ low: to100(Math.min(a, b)), high: to100(Math.max(a, b)) });
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

type Side = "low" | "high";
const pick = (r: [number, number] | undefined, side: Side) => (r ? r[side === "low" ? 0 : 1] : 0);

function parentIncomeRange(ws: Workspace, aid: AidProfile): [number, number] | null {
  if (typeof aid.parentAgi === "number") return [aid.parentAgi, aid.parentAgi];
  const bracket = ws.onboarding.listPrefs?.incomeBracket;
  return bracket && bracket !== "unsure" ? INCOME_BRACKET[bracket] : null;
}

/** The SAI and Pell estimate from the student's aid details (dependent students, Formula A). */
export function estimateSai(ws: Workspace): SaiEstimate {
  const aid = ws.aidProfile ?? {};
  const base = { awardYear: SAI_AWARD_YEAR, source: SAI_GUIDE_URL, sai: null, pell: null };
  if (ws.onboarding.listPrefs?.needAid === false) return { ...base, status: "not_applying", assumptions: [] };
  if (aid.independent === "yes") {
    return { ...base, status: "independent", assumptions: ["Independent students use a different FAFSA formula (no parent information). Ask each school's aid office to confirm your status; Forge doesn't estimate it."] };
  }
  const assumptions: string[] = [];
  const filed = aid.parentsFiledTaxes !== "no";
  const income = parentIncomeRange(ws, aid);
  if (filed && !income) return { ...base, status: "needs_income", assumptions: ["Add your parents' approximate 2025 income (or an income range) to see an estimate."] };

  const married = aid.parentStatus === "married" || aid.parentStatus === "unmarried_together";
  const singleParent = !!aid.parentStatus && !married;
  const familySize = aid.householdSize ?? (married ? 3 : 2);
  const state = (ws.profile.residency || "").trim().toUpperCase();
  if (!aid.householdSize) assumptions.push(`Household of ${familySize} (you and ${married ? "two parents" : "one parent"}); add your household size if it's larger.`);
  if (!aid.parentStatus) assumptions.push("Parents assumed married; a single parent qualifies for Pell at a higher income.");
  if (typeof aid.parentAgi !== "number" && income) assumptions.push(`Parent income ${money(income[0])}-${money(income[1])} from your income range${income[1] === 200 * K ? " (it could be higher)" : ""}.`);
  assumptions.push("Income treated as wages; federal income tax estimated from the 2025 standard deduction and brackets.");
  if (aid.parentAssets === undefined) assumptions.push("No parent savings or investments counted.");
  if (aid.studentIncome === undefined) assumptions.push("No earnings of your own counted.");
  if (aid.studentSavings === undefined) assumptions.push("No savings of your own counted.");
  if (aid.business === "yes") assumptions.push("The FAFSA leaves out a family business with 100 or fewer employees and a family farm you live on; a larger business would raise the SAI.");
  if (aid.parentsFiledTaxes === "no") assumptions.push("Parents didn't file a 2025 federal tax return: the FAFSA sets the SAI to -1,500 and gives the maximum Pell Grant.");
  if (aid.benefits === "yes") assumptions.push("Federal benefits like SNAP or SSI usually mean the maximum Pell Grant; the FAFSA still checks income against the poverty line.");
  assumptions.push(`Pell amounts use the 2026-27 maximum (${money(MAX_PELL)}); the 2027-28 maximum is announced in early 2027.`);

  const run = (side: Side) => {
    const agi = filed ? pick(income ?? undefined, side) : 0;
    const status: FilingStatus = married ? "mfj" : "hoh";
    const tax = estimateIncomeTax(agi, married ? "mfj" : "hoh", Math.max(1, familySize - (married ? 2 : 1)));
    const sEarn = pick(STUDENT_INCOME[aid.studentIncome ?? ""], side);
    const sTax = estimateIncomeTax(sEarn, "single");
    // Appendix E (APPROXIMATION of the FAFSA Specifications rule): no assets when AGI is under $60,000 and the
    // family has no business income, or when the student qualifies for the maximum Pell Grant.
    const pellGuess = pellFor(0, { parentsFiledTaxes: filed, singleParent, parentAgi: agi, familySize, state });
    const assetsExempt = pellGuess.maxPell || (agi < 60 * K && aid.business !== "yes");
    const sav = pick(STUDENT_SAVINGS[aid.studentSavings ?? ""], side);
    const result = formulaA({
      parentsMarried: married, familySize, parentIncome: agi, parentIncomeTaxPaid: tax,
      parentEarners: [{ earnings: agi, status }], parentCash: pick(PARENT_ASSETS[aid.parentAssets ?? ""], side), parentInvestments: 0,
      assetsExempt, studentIncome: sEarn, studentIncomeTaxPaid: sTax, studentEarnings: sEarn, studentCash: sav, studentInvestments: 0,
    });
    return pellFor(result.sai, { parentsFiledTaxes: filed, singleParent, parentAgi: agi, familySize, state });
  };
  const low = run("low");
  const high = run("high");
  const sai = span(low.sai, high.sai);
  const awards = span(low.award, high.award);
  const exact = (n: number) => (n === MAX_PELL ? MAX_PELL : to100(n));
  const amount = { low: exact(Math.min(low.award, high.award)), high: exact(Math.max(low.award, high.award)) };
  const eligible = awards.low > 0 ? "yes" : awards.high > 0 ? "maybe" : "no";
  return { ...base, status: "ok", sai, pell: { eligible, amount }, assumptions };
}

/** "Meets 100% of need" or "Yes: ... full need" in the research file. A "No" or an average below 100% doesn't count. */
export function meetsFullNeed(value: string | undefined): boolean {
  const t = String(value || "").trim();
  if (!t || /^(no|nearly|partial|does not|doesn't)\b/i.test(t) || /\bdoes(n't| not) meet\b/i.test(t)) return false;
  return /\b(meets?|meeting|guarantees?)\s+(100%|full\b)|^yes\b[^.;]*(\b100%|\bfull\b)/i.test(t);
}

const factValue = (r: SchoolResearch | null, key: string) => r?.facts.find((f) => f.key === key)?.value;

function schoolEstimate(ws: Workspace, c: College, sai: Range | null, cap: number | null, incomeMid: number | null): SchoolAidEstimate {
  const research = c.research ?? loadSchoolResearch(c.slug) ?? loadSchoolResearch(c.name);
  const coaValue = factValue(research, "sticker_cost");
  const coa = coaValue ? dollars(coaValue) : null;
  const need = coa !== null && sai ? { low: Math.max(0, coa - Math.max(0, sai.high)), high: Math.max(0, coa - Math.max(0, sai.low)) } : null;
  const name = c.short || c.name;
  const row = { slug: c.slug, name, coa, need };
  const fits = (r: Range | null): SchoolAidEstimate["fitsBudget"] => (!r || cap === null ? null : r.high <= cap ? "yes" : r.low > cap ? "no" : "maybe");
  const residency = (ws.profile.residency || "").trim().toUpperCase();
  if (outOfStatePublic(schoolPlace(c.name, c.slug), residency)) {
    return { ...row, netPrice: null, basis: "nonresident", fitsBudget: null, note: "Public universities give out-of-state students little need-based aid; expect close to full cost. Check its net price calculator." };
  }
  if (sai && coa !== null && meetsFullNeed(factValue(research, "meets_full_need"))) {
    const netPrice = { low: Math.min(coa, Math.max(0, sai.low)), high: Math.min(coa, Math.max(0, sai.high)) };
    return { ...row, netPrice, basis: "full_need", fitsBudget: fits(netPrice), note: "You'd pay about your SAI. The school uses its own formula (often the CSS Profile), and the package may include work-study or loans." };
  }
  const key = incomeMid !== null ? NET_PRICE_KEY.find(([top]) => incomeMid < top)?.[1] : undefined;
  const avgValue = key ? factValue(research, key) : undefined;
  const avg = avgValue ? dollars(avgValue) : null;
  if (avg !== null) {
    const netPrice = { low: to100(avg), high: to100(avg) };
    return { ...row, netPrice, basis: "school_average", fitsBudget: fits(netPrice), note: "What families at your income paid on average after grants (federal data). Yours can differ." };
  }
  return { ...row, netPrice: null, basis: "none", fitsBudget: null, note: "Forge has no net price for your income here yet. Use the school's net price calculator." };
}

/** The whole estimate: SAI, Pell, and one row per school on the list. */
export function aidEstimate(ws: Workspace): AidEstimate {
  const est = estimateSai(ws);
  const prefs = ws.onboarding.listPrefs;
  const budgetCap = prefs?.budget ? BUDGET_CAP[prefs.budget] ?? null : null;
  if (est.status === "not_applying") return { ...est, schools: [], budgetCap };
  const income = parentIncomeRange(ws, ws.aidProfile ?? {});
  const incomeMid = income ? (income[0] + income[1]) / 2 : null;
  const schools = ws.colleges.map((c) => schoolEstimate(ws, c, est.sai, budgetCap, incomeMid));
  return { ...est, schools, budgetCap };
}

/** One school's row, for pages that show a single college (e.g. the school detail page). */
export function schoolAidEstimate(ws: Workspace, slug: string): SchoolAidEstimate | null {
  return aidEstimate(ws).schools.find((s) => s.slug === slug) ?? null;
}
