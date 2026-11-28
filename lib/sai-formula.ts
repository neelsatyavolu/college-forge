/**
 * The federal Student Aid Index (SAI), Formula A (dependent students), and Pell Grant eligibility for the
 * 2027-28 award year: the FAFSA that students entering college in fall 2027 file, using 2025 tax information.
 *
 * Source: U.S. Department of Education, "2027-28 Student Aid Index (SAI) and Pell Grant Eligibility Guide",
 * Version 1, June 2026:
 *   https://fsapartners.ed.gov/sites/default/files/2026-06/2728StudentAidIndexSAIandPellGrantEligibilityGuide.pdf
 * Every table value below is copied from that guide (table names in the comments), and tests/aid-estimate.test.cjs
 * reproduces its Formula A exemplar (Table 11, SAI 12,198). Poverty guidelines: HHS 2025, Federal Register
 * Vol. 90, No. 11 (Jan 17, 2025), https://www.govinfo.gov/content/pkg/FR-2025-01-17/html/2025-01377.htm
 *
 * Exact for exact inputs. lib/aid-estimate.ts feeds it ranges and approximations, and says so.
 */

export const SAI_AWARD_YEAR = "2027-28";
export const SAI_GUIDE_URL = "https://fsapartners.ed.gov/sites/default/files/2026-06/2728StudentAidIndexSAIandPellGrantEligibilityGuide.pdf";
export const POVERTY_GUIDELINES_URL = "https://www.govinfo.gov/content/pkg/FR-2025-01-17/html/2025-01377.htm";

/**
 * Maximum Pell Grant. 2026-27: $7,395 (Dear Colleague Letter GEN-26-01, Jan 30, 2026). The 2027-28 maximum is
 * announced in early 2027, so this is an APPROXIMATION carried over from 2026-27. Minimum Pell is 10% of it ($740).
 */
export const MAX_PELL = 7395;
export const MIN_PELL = 740;
export const PELL_SOURCE_URL = "https://fsapartners.ed.gov/knowledge-center/library/dear-colleague-letters/2026-01-30/2026-27-federal-pell-grant-maximum-and-minimum-award-amounts";

/** Guide, "Notes for Calculating the SAI": round to three decimals, then to a whole number, .5 away from zero. */
export function saiRound(x: number): number {
  const three = Math.round(Math.abs(x) * 1000) / 1000;
  return Math.sign(x) * Math.floor(three + 0.5);
}
const round3 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 1000) / 1000;

/** Table A2: Income Protection Allowance by family size (2: $30,300 … 6: $64,290; +$7,260 each). */
const IPA: Record<number, number> = { 2: 30_300, 3: 37_720, 4: 46_590, 5: 54_970, 6: 64_290 };
export function incomeProtectionAllowance(familySize: number): number {
  const n = Math.max(2, Math.round(familySize));
  return n <= 6 ? IPA[n] : IPA[6] + (n - 6) * 7_260;
}
/** Formula A line 25: the dependent student's income protection allowance. */
export const STUDENT_IPA = 12_220;
/** Formula A line 7: employment expense allowance, the lesser of 35% of earnings and $5,200. */
const EEA_CAP = 5_200;

export type FilingStatus = "mfj" | "single" | "hoh" | "mfs" | "qss";

/**
 * Table A1: Medicare (HI) and Social Security (OASDI) for one filer. MFJ uses the couple's combined earnings
 * with the $250,000 / $352,200 thresholds; other statuses are per person ($200,000, or $125,000 for MFS; $176,100).
 */
function payroll(earnings: number, status: FilingStatus): { hi: number; oasdi: number } {
  const hiLimit = status === "mfj" ? 250_000 : status === "mfs" ? 125_000 : 200_000;
  const base = status === "mfj" ? 352_200 : 176_100;
  const e = Math.max(0, earnings);
  return {
    hi: round3(0.0145 * Math.min(e, hiLimit) + 0.0235 * Math.max(0, e - hiLimit)),
    oasdi: round3(0.062 * Math.min(e, base)),
  };
}

/** Payroll tax allowance for a set of filers, each rounded to 3 decimals, totals rounded (Appendix K). */
function payrollAllowance(filers: { earnings: number; status: FilingStatus }[]): number {
  const parts = filers.map((f) => payroll(f.earnings, f.status));
  return saiRound(parts.reduce((s, p) => s + p.hi, 0)) + saiRound(parts.reduce((s, p) => s + p.oasdi, 0));
}

/** Table A3: adjusted net worth of a business or farm (the FAFSA excludes small family businesses and family farms). */
export function adjustedBusinessNetWorth(netWorth: number): number {
  if (netWorth < 1) return 0;
  if (netWorth <= 180_000) return saiRound(0.4 * netWorth);
  if (netWorth <= 540_000) return saiRound(72_000 + 0.5 * (netWorth - 180_000));
  if (netWorth <= 905_000) return saiRound(252_000 + 0.6 * (netWorth - 540_000));
  return saiRound(471_000 + (netWorth - 905_000));
}

/** Table A5: parents' contribution from adjusted available income. */
export function parentContribution(aai: number): number {
  if (aai < -8_900) return -1_958;
  if (aai <= 22_600) return saiRound(0.22 * aai);
  if (aai <= 28_300) return saiRound(4_972 + 0.25 * (aai - 22_600));
  if (aai <= 34_000) return saiRound(6_397 + 0.29 * (aai - 28_300));
  if (aai <= 39_900) return saiRound(8_050 + 0.34 * (aai - 34_000));
  if (aai <= 45_600) return saiRound(10_056 + 0.4 * (aai - 39_900));
  return saiRound(12_336 + 0.47 * (aai - 45_600));
}

export type FormulaAInput = {
  /** Parent married indicator (Appendix F): married, remarried, or unmarried and living together. */
  parentsMarried: boolean;
  familySize: number;
  /** Parents' AGI plus the other income additions (lines a-f) minus offsets (lines g-i). */
  parentIncome: number;
  parentIncomeTaxPaid: number;
  /** Income earned from work, one entry per filer, with that filer's status. */
  parentEarners: { earnings: number; status: FilingStatus }[];
  /** Lines 10-13. Ignored when assetsExempt. */
  parentChildSupport?: number;
  parentCash: number;
  parentInvestments: number;
  parentBusinessNetWorth?: number;
  /** Appendix E: the family doesn't have to report assets. */
  assetsExempt?: boolean;
  studentIncome: number;
  studentIncomeTaxPaid: number;
  studentEarnings: number;
  studentCash: number;
  studentInvestments: number;
  studentBusinessNetWorth?: number;
};

export type FormulaAResult = { sai: number; parentContribution: number; studentIncomeContribution: number; studentAssetContribution: number; parentAvailableIncome: number; parentAdjustedAvailableIncome: number };

/** Worksheet A, lines 1-37. */
export function formulaA(i: FormulaAInput): FormulaAResult {
  const earned = i.parentEarners.reduce((s, e) => s + Math.max(0, e.earnings), 0);
  const allowances = i.parentIncomeTaxPaid + payrollAllowance(i.parentEarners) + incomeProtectionAllowance(i.familySize) + Math.min(saiRound(0.35 * earned), EEA_CAP);
  const pai = i.parentIncome - allowances;
  const netWorth = i.assetsExempt ? 0 : (i.parentChildSupport ?? 0) + i.parentCash + Math.max(0, i.parentInvestments) + adjustedBusinessNetWorth(i.parentBusinessNetWorth ?? 0);
  const pca = Math.max(0, saiRound(netWorth * 0.12));
  const paai = pai + pca;
  const pc = parentContribution(paai);

  const studentAllowances = i.studentIncomeTaxPaid + payrollAllowance([{ earnings: i.studentEarnings, status: "single" }]) + STUDENT_IPA + (paai < 0 ? -paai : 0);
  const sci = Math.max(0, saiRound((i.studentIncome - studentAllowances) * 0.5));
  const studentWorth = i.assetsExempt ? 0 : i.studentCash + Math.max(0, i.studentInvestments) + adjustedBusinessNetWorth(i.studentBusinessNetWorth ?? 0);
  const sca = Math.max(0, saiRound(studentWorth * 0.2));
  const sai = Math.min(999_999, Math.max(-1_500, pc + sci + sca));
  return { sai, parentContribution: pc, studentIncomeContribution: sci, studentAssetContribution: sca, parentAvailableIncome: pai, parentAdjustedAvailableIncome: paai };
}

/** HHS 2025 poverty guideline: 48 states and DC $15,650 + $5,500 per person; Alaska $19,550 + $6,880; Hawaii $17,990 + $6,330. */
export function povertyGuideline(familySize: number, state: string): number {
  const n = Math.max(1, Math.round(familySize));
  const [base, step] = state === "AK" ? [19_550, 6_880] : state === "HI" ? [17_990, 6_330] : [15_650, 5_500];
  return base + (n - 1) * step;
}

export type PellInput = {
  parentsFiledTaxes: boolean;
  /** Single parent (Appendix G): an unmarried parent who files as head of household or gets the EITC. */
  singleParent: boolean;
  /** Parents' AGI plus foreign income exclusion. */
  parentAgi: number;
  familySize: number;
  state: string;
};

export type PellResult = { sai: number; maxPell: boolean; minPellIndicator: boolean; award: number };

/**
 * Steps 1-3: maximum Pell by income vs the poverty line (175%, or 225% for a single parent), the calculated SAI,
 * then minimum Pell (275% / 325%) when the SAI is under twice the maximum Pell.
 */
export function pellFor(calculatedSai: number, p: PellInput): PellResult {
  if (!p.parentsFiledTaxes) return { sai: -1_500, maxPell: true, minPellIndicator: true, award: MAX_PELL };
  const line = povertyGuideline(p.familySize, p.state);
  const maxPell = p.parentAgi > 0 && p.parentAgi <= saiRound(line * (p.singleParent ? 2.25 : 1.75));
  const minPellIndicator = p.parentAgi <= saiRound(line * (p.singleParent ? 3.25 : 2.75));
  const sai = maxPell ? Math.min(calculatedSai, 0) : calculatedSai;
  let award = 0;
  if (sai <= 0) award = MAX_PELL;
  else if (sai <= MAX_PELL - MIN_PELL) award = MAX_PELL - sai;
  else if (minPellIndicator && sai < 2 * MAX_PELL) award = MIN_PELL;
  return { sai, maxPell, minPellIndicator, award };
}
