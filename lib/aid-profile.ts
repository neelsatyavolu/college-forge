/**
 * Optional family details for a better financial-aid estimate (lib/aid-estimate.ts). Asked only when the student
 * is applying for need-based aid or isn't sure. Every field can be skipped, and most are ranges, not exact numbers.
 *
 * Private to the student: parent views, share links and the counselor brief pick their fields one by one
 * (lib/parent-view.ts, lib/store.ts publicShareView), so `aidProfile` never reaches them. Never store an SSN,
 * an FSA ID or password, or a tax document here; the schema only allows the fields below.
 */
import { z } from "zod";
import type { Parsed, WriteMode } from "./profile-fields";

export const PARENT_STATUS = ["married", "unmarried_together", "divorced_separated", "single", "widowed"] as const;
/** Parent cash, savings and investments, not counting retirement accounts or the family home ($1,000s). */
export const PARENT_ASSETS = ["lt10", "10-50", "50-100", "100-250", "250-500", "gt500"] as const;
/** Home equity: what the home is worth minus what's owed ($1,000s). The CSS Profile asks; the FAFSA doesn't. */
export const HOME_EQUITY = ["none", "lt100", "100-250", "250-500", "gt500"] as const;
/** What the student earned in 2025 ($1,000s). */
export const STUDENT_INCOME = ["lt5", "5-12", "12-20", "gt20"] as const;
/** The student's own savings and investments ($1,000s). */
export const STUDENT_SAVINGS = ["lt1", "1-5", "5-15", "gt15"] as const;
export const YES_NO_UNSURE = ["yes", "no", "unsure"] as const;

export type AidProfile = {
  /** People the parents support, including the student (FAFSA family size). */
  householdSize?: number;
  /** Family members in college in 2027-28, including the student (the CSS Profile uses it; the FAFSA no longer does). */
  inCollege?: number;
  parentStatus?: (typeof PARENT_STATUS)[number];
  /** Did the parents file a 2025 federal tax return? */
  parentsFiledTaxes?: (typeof YES_NO_UNSURE)[number];
  /** Parents' 2025 adjusted gross income, roughly (a round number is fine). */
  parentAgi?: number;
  parentAssets?: (typeof PARENT_ASSETS)[number];
  homeEquity?: (typeof HOME_EQUITY)[number];
  /** The family owns a business or farm. */
  business?: (typeof YES_NO_UNSURE)[number];
  studentIncome?: (typeof STUDENT_INCOME)[number];
  studentSavings?: (typeof STUDENT_SAVINGS)[number];
  /** Anyone in the household got SNAP, SSI, TANF, WIC, Medicaid or free/reduced lunch in 2025-26. */
  benefits?: (typeof YES_NO_UNSURE)[number];
  /** Independent by the FAFSA's rules (foster care or ward of the court after 13, emancipated, unaccompanied homeless youth, married, veteran, supports a child). */
  independent?: (typeof YES_NO_UNSURE)[number];
};

/** One line per field: why it's asked. Shown next to each question in the hub and given to the AI. */
export const AID_FIELD_WHY: Record<keyof AidProfile, string> = {
  householdSize: "Bigger households get a larger income allowance, which lowers what the FAFSA expects you to pay.",
  inCollege: "The CSS Profile splits the parent share between siblings in college; the FAFSA no longer does.",
  parentStatus: "It decides whose income counts, and divorced or separated parents may mean a second CSS Profile.",
  parentsFiledTaxes: "If your parents didn't have to file a 2025 return, you get the maximum Pell Grant.",
  parentAgi: "Income is the biggest part of the formula. A round number is fine.",
  parentAssets: "Savings and investments add to what's expected; retirement accounts and your home don't count.",
  homeEquity: "Many CSS Profile schools count home equity; the FAFSA doesn't.",
  business: "The FAFSA skips small family businesses and family farms, but CSS Profile schools ask about them.",
  studentIncome: "Your own earnings above about $12,000 raise your share.",
  studentSavings: "Your own savings count more heavily than your parents'.",
  benefits: "Federal benefits are a strong sign of Pell eligibility and can let you skip the asset questions.",
  independent: "Independent students leave parent information off the FAFSA. It's rare; your aid office decides edge cases.",
};

export const AID_PRIVACY_NOTE = "These stay in your workspace. Parents, counselors and share links don't see them.";

const int = (label: string, min: number, max: number) =>
  z.union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : v))
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max), `${label} must be a number from ${min} to ${max}.`)
    .transform((v) => (v === "" ? undefined : Math.round(Number(v))));

const choice = <T extends readonly [string, ...string[]]>(label: string, values: T) =>
  z.enum(values, { error: `${label} must be one of ${values.join(", ")}.` });

const aidProfileSchema = z.object({
  householdSize: int("Household size", 1, 15).optional(),
  inCollege: int("Family members in college", 1, 8).optional(),
  parentStatus: choice("Parents' marital status", PARENT_STATUS).optional(),
  parentsFiledTaxes: choice("Parents filed taxes", YES_NO_UNSURE).optional(),
  parentAgi: int("Parent income", 0, 10_000_000).optional(),
  parentAssets: choice("Parent savings", PARENT_ASSETS).optional(),
  homeEquity: choice("Home equity", HOME_EQUITY).optional(),
  business: choice("Business or farm", YES_NO_UNSURE).optional(),
  studentIncome: choice("Your earnings", STUDENT_INCOME).optional(),
  studentSavings: choice("Your savings", STUDENT_SAVINGS).optional(),
  benefits: choice("Federal benefits", YES_NO_UNSURE).optional(),
  independent: choice("Independent student", YES_NO_UNSURE).optional(),
}).strict();

export type AidProfilePatch = { [K in keyof AidProfile]?: AidProfile[K] | null };

/**
 * Validates an aid-profile patch. null (or "" in the hub form) clears a field. In "tool" mode, "" and 0 mean
 * "not provided" (models fill optional arguments with them), so they are dropped instead of clearing.
 */
export function parseAidProfile(raw: unknown, mode: WriteMode = "form"): Parsed<AidProfilePatch> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "aidProfile must be an object." };
  const clears: AidProfilePatch = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const blank = value === null || value === "" || (mode === "tool" && value === 0 && key !== "parentAgi");
    if (!blank) { rest[key] = value; continue; }
    if (mode === "form" && key in aidProfileSchema.shape) (clears as Record<string, null>)[key] = null;
    else if (!(key in aidProfileSchema.shape)) rest[key] = value;
  }
  const parsed = aidProfileSchema.safeParse(rest);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Check the aid details." };
  const value = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as AidProfilePatch;
  return { ok: true, value: { ...value, ...clears } };
}

/** Merges a validated patch: a value sets the field, null removes it. Returns a new object. */
export function applyAidProfile(current: AidProfile | undefined, patch: AidProfilePatch): AidProfile {
  const merged: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in AID_FIELD_WHY)) continue;
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  return merged as AidProfile;
}

/** Ask for aid details only when the student is applying for need-based aid or hasn't said (not sure). */
export function wantsAidDetails(needAid: boolean | undefined): boolean {
  return needAid !== false;
}

/** The fields that move the estimate most, still blank. Optional: never blocks the interview. */
export function missingAidDetails(profile: AidProfile | undefined): (keyof AidProfile)[] {
  const p = profile ?? {};
  const keys: (keyof AidProfile)[] = ["householdSize", "parentStatus", "parentsFiledTaxes", "parentAgi", "parentAssets", "studentIncome", "studentSavings", "benefits", "independent", "inCollege", "homeEquity", "business"];
  return keys.filter((k) => p[k] === undefined);
}
