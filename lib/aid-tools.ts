/**
 * AI tools for financial aid details: save the optional family details (onboarding money section, or the copilot
 * when the student offers them) and read the estimate plus the FAFSA / CSS Profile steps, so "help me fill out the
 * FAFSA" gets answers grounded in the student's own situation.
 */
import type { ToolSpec } from "./chat-types";
import type { Workspace } from "./store";
import { AID_FIELD_WHY, HOME_EQUITY, PARENT_ASSETS, PARENT_STATUS, STUDENT_INCOME, STUDENT_SAVINGS, YES_NO_UNSURE, applyAidProfile, parseAidProfile } from "./aid-profile";
import { aidEstimate } from "./aid-estimate";
import { aidChecklist } from "./aid-checklist";
import { aidPlan } from "./aid-plan";

type Mutate = (fn: (ws: Workspace) => Workspace) => Promise<Workspace>;

/** Never part of any aid tool: what the copilot must refuse to collect. */
export const AID_SAFETY = "Never ask for, repeat or store a Social Security number, an FSA ID username or password, bank or account numbers, or tax documents; the student enters those only on StudentAid.gov or the College Board's site. If they paste one, tell them to delete it and don't save it.";

const choice = (values: readonly string[], why: string) => ({ type: "string", enum: [...values], description: why });

export const AID_TOOL_SPECS: ToolSpec[] = [
  {
    name: "set_aid_details",
    description: `Save optional family details that sharpen the financial-aid estimate. Only for a student applying for need-based aid or unsure. Pass only what the student said; every field is optional and skippable. Ranges are in $1,000s. ${AID_SAFETY}`,
    parameters: {
      type: "object",
      properties: {
        householdSize: { type: "number", description: `People the parents support, including the student. ${AID_FIELD_WHY.householdSize}` },
        inCollege: { type: "number", description: `Family members in college in 2027-28, including the student. ${AID_FIELD_WHY.inCollege}` },
        parentStatus: choice(PARENT_STATUS, "married | unmarried_together (unmarried, both parents in the household) | divorced_separated | single | widowed."),
        parentsFiledTaxes: choice(YES_NO_UNSURE, AID_FIELD_WHY.parentsFiledTaxes),
        parentAgi: { type: "number", description: "Parents' 2025 adjusted gross income in dollars, roughly (\"about 85k\" is 85000)." },
        parentAssets: choice(PARENT_ASSETS, "Parent cash, savings and investments, not retirement or the home, in $1,000s."),
        homeEquity: choice(HOME_EQUITY, "Home value minus mortgage, $1,000s (CSS Profile only)."),
        business: choice(YES_NO_UNSURE, "The family owns a business or farm."),
        studentIncome: choice(STUDENT_INCOME, "The student's 2025 earnings, $1,000s."),
        studentSavings: choice(STUDENT_SAVINGS, "The student's own savings, $1,000s."),
        benefits: choice(YES_NO_UNSURE, "Anyone in the household got SNAP, SSI, TANF, WIC, Medicaid or free/reduced lunch."),
        independent: choice(YES_NO_UNSURE, "Independent by FAFSA rules: foster care or ward of the court after 13, emancipated minor, unaccompanied homeless youth, married, veteran, or supports a child. Rare."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_aid_estimate",
    description: `Read the student's financial-aid estimate and FAFSA / CSS Profile steps: approximate 2027-28 SAI range, Pell Grant eligibility and amount, per-school need and estimated net price vs their budget (with the basis and assumptions), which list schools need the CSS Profile or IDOC, and the steps with official links. Use it when they ask what they'd pay, whether they qualify for Pell, or for help filling out the FAFSA or CSS Profile: explain step by step from this, call every number an estimate, and point to the official sites to submit. ${AID_SAFETY}`,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

export async function runAidTool(name: string, a: Record<string, unknown>, mutate: Mutate, read: () => Promise<Workspace>): Promise<string | null> {
  if (name === "set_aid_details") {
    const parsed = parseAidProfile(a, "tool");
    if (!parsed.ok) return parsed.error;
    const saved = Object.keys(parsed.value);
    if (!saved.length) return "Nothing to save: pass only the details the student gave.";
    await mutate((ws) => ({ ...ws, aidProfile: applyAidProfile(ws.aidProfile, parsed.value) }));
    return `Saved ${saved.join(", ")}. It stays private to the student.`;
  }
  if (name === "get_aid_estimate") {
    const ws = await read();
    const plan = aidPlan(ws);
    return JSON.stringify({ details: ws.aidProfile ?? {}, estimate: aidEstimate(ws), steps: aidChecklist(ws, plan) });
  }
  return null;
}
