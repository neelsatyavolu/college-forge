import { z } from "zod";
import type { Activity, Honor, APScore } from "./store";

/**
 * Server-side rules for every profile write (Profile page, in-app copilot, MCP agents). They match the
 * checks in public/hub/Profile.jsx, so a write the page would refuse is refused here too.
 *
 * Two modes:
 * - "form": the Profile page sends every field; "" clears a text field and a blank stat becomes "—".
 * - "tool": models fill optional arguments with "" or 0, so "", 0 and null mean "not provided".
 *   Send "—" to clear a stat.
 */
export type WriteMode = "form" | "tool";

export const MAX_ACTIVITIES = 10;
export const MAX_HONORS = 5;
export const ACTIVITY_DESC_LIMIT = 150;
const TEXT_LIMIT = 200;
const DASH = "—";

const US_STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky",
  LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota",
  MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire",
  NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota",
  OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island",
  SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont",
  VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  PR: "puerto rico", GU: "guam", VI: "u.s. virgin islands", AS: "american samoa", MP: "northern mariana islands",
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [name, code]));

/** A 2-letter US state or territory code for a code or full name in any case; null when it is neither. */
export function stateCode(value: string): string | null {
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v) && US_STATES[v.toUpperCase()]) return v.toUpperCase();
  return STATE_BY_NAME.get(v.toLowerCase()) ?? null;
}

const text = (label: string, max = TEXT_LIMIT) =>
  z.string({ error: `${label} must be text.` }).trim().max(max, `${label} can be up to ${max} characters.`);

/** A GPA or score kept as text: a number in range, or "—" for none. A blank becomes "—". */
const stat = (label: string, min: number, max: number, integer: boolean) =>
  z.union([z.string(), z.number()], { error: `${label} must be a number.` })
    .transform((v) => String(v).trim())
    .refine(
      (v) => v === "" || v === DASH || ((integer ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(v) && Number(v) >= min && Number(v) <= max),
      `${label} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}, or left blank.`
    )
    .transform((v) => (v === "" ? DASH : v));

const gradYear = z.union([z.string(), z.number()], { error: "Graduation year must be a year." })
  .transform((v) => String(v).trim())
  .refine((v) => v === "" || (/^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= 2100), "Graduation year must be a four-digit year from 1900 to 2100, or left blank.")
  .transform((v) => (v === "" ? "" : Number(v)));

const residency = z.string({ error: "Residency must be text." })
  .transform((v) => v.trim())
  .refine((v) => v === "" || stateCode(v) !== null, "Residency must be a two-letter US state code, such as CA, or left blank.")
  .transform((v) => (v === "" ? "" : stateCode(v)!));

const ranged = (label: string, max: number) =>
  z.union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max), `${label} must be between 0 and ${max}.`);

export const activitySchema = z.object({
  rank: z.number().optional(),
  name: text("Activity name").min(1, "Each activity needs a name."),
  type: text("Activity type", 80).optional(),
  org: text("Organization").optional(),
  years: text("Grades", 80).optional(),
  role: text("Role").optional(),
  hpw: ranged("Hours per week", 168).optional(),
  wpy: ranged("Weeks per year", 52).optional(),
  college: z.boolean().optional(),
  desc: z.string().trim().max(ACTIVITY_DESC_LIMIT, `Activity descriptions can be up to ${ACTIVITY_DESC_LIMIT} characters.`).optional(),
  bullets: z.array(text("Bullet", 300)).max(10).optional(),
});

export const honorSchema = z.object({
  title: text("Honor title").min(1, "Each honor needs a title."),
  level: text("Honor level", 40).optional(),
  year: text("Honor year", 40).optional(),
  top: z.boolean().optional(),
});

const apSchema = z.object({
  course: text("AP course").min(1, "Each AP exam needs a course name."),
  score: z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^[1-5]$/.test(v), "AP scores must be from 1 to 5. Put planned exams in coursework."),
});

const courseList = z.array(text("Course")).max(40, "Keep each coursework list to 40 courses.")
  .transform((list) => list.filter(Boolean));

export const applicantFieldsSchema = z.object({
  name: text("Name").optional(),
  cycle: text("Cycle").optional(),
  year: text("Year").optional(),
  gpaWeighted: stat("Weighted GPA", 0, 6, false).optional(),
  gpaUnweighted: stat("Unweighted GPA", 0, 4, false).optional(),
  sat: stat("SAT", 400, 1600, true).optional(),
  satNote: text("SAT note").optional(),
});

export const testingFieldsSchema = z.object({
  sat: stat("SAT", 400, 1600, true).optional(),
  satNote: text("SAT note").optional(),
  act: stat("ACT", 1, 36, true).optional(),
  aps: z.array(apSchema).max(40, "Keep the AP list to 40 exams.").optional(),
});

export const profileFieldsSchema = z.object({
  intended: text("Intended major").optional(),
  hs: text("High school").optional(),
  gradYear: gradYear.optional(),
  location: text("Location").optional(),
  counselor: text("Counselor").optional(),
  residency: residency.optional(),
  testing: testingFieldsSchema.optional(),
  coursework: z.object({ honors: courseList.optional(), aps: courseList.optional(), senior: courseList.optional() }).optional(),
  activities: z.array(activitySchema).max(MAX_ACTIVITIES, `Keep up to ${MAX_ACTIVITIES} activities.`).optional(),
  honors: z.array(honorSchema).max(MAX_HONORS, `Keep up to ${MAX_HONORS} honors.`).optional(),
});

export type ParsedApplicant = z.infer<typeof applicantFieldsSchema>;
export type ParsedProfile = z.infer<typeof profileFieldsSchema>;

/** Drops absent scalar values: null and undefined always, and "" and 0 in tool mode. Nested objects and arrays are left alone. */
export function dropBlanks(value: unknown, mode: WriteMode): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) =>
    v !== undefined && v !== null && (mode === "form" || (v !== "" && v !== 0))
  ));
}

/**
 * A yes/no flag from an agent tool call. Agents fill unused optional booleans with false, so false is
 * treated as absent; "no" is how a tool says no on purpose.
 */
export function toolFlag(value: unknown): boolean | undefined {
  if (value === true || value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message || "That profile change isn't valid.";
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseWith<T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> {
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: firstIssue(result.error) };
}

export function parseApplicantFields(raw: unknown, mode: WriteMode): Parsed<ParsedApplicant> {
  return parseWith(applicantFieldsSchema, dropBlanks(raw, mode));
}

export function parseProfileFields(raw: unknown, mode: WriteMode): Parsed<ParsedProfile> {
  const base = dropBlanks(raw, mode) as Record<string, unknown> | unknown;
  const cleaned = base && typeof base === "object" && !Array.isArray(base) && (base as Record<string, unknown>).testing
    ? { ...(base as Record<string, unknown>), testing: dropBlanks((base as Record<string, unknown>).testing, mode) }
    : base;
  return parseWith(profileFieldsSchema, cleaned);
}

type ParsedActivity = z.infer<typeof activitySchema>;
type ParsedHonor = z.infer<typeof honorSchema>;

/** Orders by the given rank (unranked rows keep their place after ranked ones) and renumbers from 1. */
export function rankActivities(list: ParsedActivity[] | Activity[]): Activity[] {
  return list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.rank ?? Infinity) - (y.a.rank ?? Infinity) || x.i - y.i)
    .map(({ a }, i) => ({ ...a, type: a.type ?? "", rank: i + 1 }) as Activity);
}

export function toHonors(list: ParsedHonor[]): Honor[] {
  return list.map((h) => ({ ...h, level: h.level ?? "" }));
}

export function toAps(list: { course: string; score: string }[]): APScore[] {
  return list.map((ap) => ({ course: ap.course, score: ap.score }));
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Adds or merges one activity. It matches `match` (or the new name) against existing names, or uses
 * `rank` to pick a slot. Fields left out keep their stored values. The list is capped and renumbered.
 */
export function upsertActivity(list: Activity[], raw: unknown, match?: string): Parsed<{ list: Activity[]; created: boolean }> {
  const fields = dropBlanks(raw, "tool") as Record<string, unknown>;
  const key = match || (typeof fields.name === "string" ? fields.name : "");
  const byName = key ? list.findIndex((a) => sameName(a.name, key)) : -1;
  const byRank = byName < 0 && !match && typeof fields.rank === "number" && !fields.name
    ? list.findIndex((a) => a.rank === fields.rank)
    : -1;
  const index = byName >= 0 ? byName : byRank;
  if (match && index < 0) return { ok: false, error: `No activity is named "${match}".` };
  if (index < 0 && list.length >= MAX_ACTIVITIES) return { ok: false, error: `The list already has ${MAX_ACTIVITIES} activities. Remove one first.` };
  const parsed = parseWith(activitySchema, index >= 0 ? { ...list[index], ...fields } : fields);
  if (!parsed.ok) return parsed;
  const row = { ...parsed.value, type: parsed.value.type ?? "" } as Activity;
  const others = index >= 0 ? list.filter((_, i) => i !== index) : list;
  // A requested rank puts the row in that slot; otherwise it keeps its place, or goes last when new.
  const at = typeof fields.rank === "number"
    ? Math.max(0, Math.min(others.length, Math.round(fields.rank) - 1))
    : index >= 0 ? index : others.length;
  const next = [...others.slice(0, at), row, ...others.slice(at)].map((a, i) => ({ ...a, rank: i + 1 }));
  return { ok: true, value: { list: next, created: index < 0 } };
}

export function removeActivity(list: Activity[], key: { name?: string; rank?: number }): Parsed<Activity[]> {
  const index = key.name ? list.findIndex((a) => sameName(a.name, key.name!)) : list.findIndex((a) => a.rank === key.rank);
  if (index < 0) return { ok: false, error: key.name ? `No activity is named "${key.name}".` : `No activity has rank ${key.rank}.` };
  return { ok: true, value: list.filter((_, i) => i !== index).map((a, i) => ({ ...a, rank: i + 1 })) };
}

export function upsertHonor(list: Honor[], raw: unknown, match?: string): Parsed<{ list: Honor[]; created: boolean }> {
  const fields = dropBlanks(raw, "tool") as Record<string, unknown>;
  const key = match || (typeof fields.title === "string" ? fields.title : "");
  const index = key ? list.findIndex((h) => sameName(h.title, key)) : -1;
  if (match && index < 0) return { ok: false, error: `No honor is titled "${match}".` };
  if (index < 0 && list.length >= MAX_HONORS) return { ok: false, error: `The list already has ${MAX_HONORS} honors. Remove one first.` };
  const parsed = parseWith(honorSchema, index >= 0 ? { ...list[index], ...fields } : fields);
  if (!parsed.ok) return parsed;
  const [row] = toHonors([parsed.value]);
  return { ok: true, value: { list: index >= 0 ? list.map((h, i) => (i === index ? row : h)) : [...list, row], created: index < 0 } };
}

export function removeHonor(list: Honor[], title: string): Parsed<Honor[]> {
  const index = list.findIndex((h) => sameName(h.title, title));
  if (index < 0) return { ok: false, error: `No honor is titled "${title}".` };
  return { ok: true, value: list.filter((_, i) => i !== index) };
}
