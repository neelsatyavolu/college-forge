/**
 * Recommendation letters: validation for the per-school fields (asked date, email, assigned schools,
 * thank-you, brag sheet) and the copilot's request-email draft. Receipt matching against portal
 * checklists lives in public/hub/recommenders.js, which the hub and tests share.
 */
import type { Recommendation, Workspace } from "./store";

export const BRAG_SHEET_MAX = 4000;
export const EMAIL_MAX = 254;
const MAX_SCHOOLS = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Deliberately plain: one @, no spaces, a dot in the domain.
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export type RecExtras = Pick<Recommendation, "askedAt" | "email" | "schools" | "thankYouSent" | "bragSheet">;

const isRealDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().startsWith(v);

/** The reason a recommendation patch's new fields are invalid, or null. Absent fields are fine; "" clears. */
export function recExtrasError(r: Record<string, unknown>): string | null {
  if (r.askedAt !== undefined && r.askedAt !== null && r.askedAt !== "" && !(typeof r.askedAt === "string" && isRealDate(r.askedAt))) {
    return "The asked date must be yyyy-mm-dd.";
  }
  if (r.email !== undefined && r.email !== null && r.email !== "") {
    if (typeof r.email !== "string" || r.email.trim().length > EMAIL_MAX || !EMAIL.test(r.email.trim())) return "Enter a valid email for the recommender.";
  }
  if (r.schools !== undefined && r.schools !== null) {
    if (!Array.isArray(r.schools) || r.schools.length > MAX_SCHOOLS || r.schools.some((s) => typeof s !== "string" || s.length > 80)) {
      return "Assigned schools must be a list of application ids.";
    }
  }
  if (r.thankYouSent !== undefined && r.thankYouSent !== null && typeof r.thankYouSent !== "boolean") return "thankYouSent must be true or false.";
  if (r.bragSheet !== undefined && r.bragSheet !== null && r.bragSheet !== "") {
    if (typeof r.bragSheet !== "string" || r.bragSheet.length > BRAG_SHEET_MAX) return `The brag sheet can be at most ${BRAG_SHEET_MAX} characters.`;
  }
  return null;
}

/**
 * The new fields for a saved row: input wins over existing, "" clears, invalid values are dropped, and
 * schools keep only ids of applications the student tracks (deduped, in order).
 */
export function recExtras(input: Record<string, unknown>, existing: Partial<Recommendation> | undefined, appIds: ReadonlySet<string>): RecExtras {
  const pick = <K extends keyof RecExtras>(k: K): unknown => (input[k] !== undefined && input[k] !== null ? input[k] : existing?.[k]);
  const out: RecExtras = {};
  const askedAt = pick("askedAt");
  if (typeof askedAt === "string" && isRealDate(askedAt)) out.askedAt = askedAt;
  const email = pick("email");
  if (typeof email === "string" && email.trim().length <= EMAIL_MAX && EMAIL.test(email.trim())) out.email = email.trim();
  const schools = pick("schools");
  if (Array.isArray(schools)) {
    out.schools = [...new Set(schools.filter((s): s is string => typeof s === "string" && appIds.has(s)))].slice(0, MAX_SCHOOLS);
  }
  const thanks = pick("thankYouSent");
  if (typeof thanks === "boolean") out.thankYouSent = thanks;
  const brag = pick("bragSheet");
  if (typeof brag === "string" && brag.trim()) out.bragSheet = brag.slice(0, BRAG_SHEET_MAX);
  return out;
}

/** Strips the old values of the new fields from a row, so recExtras alone decides them. */
export function withoutExtras<T extends Partial<Recommendation>>(row: T): Omit<T, keyof RecExtras> {
  const { askedAt: _a, email: _e, schools: _s, thankYouSent: _t, bragSheet: _b, ...rest } = row;
  return rest;
}

export const trackedAppIds = (ws: Workspace): Set<string> => new Set((ws.tracker?.apps ?? []).map((a) => a.id));

const firstName = (full: string) => full.trim().split(/\s+/)[0] || "";

/**
 * A polite request email and a brag-sheet outline for one recommender. Text only: the student edits
 * and sends it themselves. Built from saved facts, so nothing here is invented.
 */
export function draftRecRequest(ws: Workspace, rec: Recommendation): string {
  const student = firstName(ws.applicant?.name || "") || "[your name]";
  const major = (ws.profile?.intended || "").trim();
  const subject = (rec.subject || "").trim();
  const apps = new Map((ws.tracker?.apps ?? []).map((a) => [a.id, a]));
  const schools = (rec.schools ?? []).map((id) => apps.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
  const dated = schools.map((a) => a.deadline).filter(Boolean).sort();
  const earliest = dated[0] || rec.deadline || "";
  const activities = [...(ws.profile?.activities ?? [])].sort((a, b) => a.rank - b.rank).slice(0, 5);
  const why = rec.type === "counselor"
    ? "You know my whole high school record better than anyone, and I would be grateful if you could write my school report and counselor recommendation."
    : `I really enjoyed ${subject ? `your ${subject} class` : "your class"}, and I would be honored if you would write a letter of recommendation for my college applications.`;
  const lines = [
    `Subject: Letter of recommendation request${subject ? ` (${subject})` : ""}`,
    "",
    `Dear ${rec.name},`,
    "",
    why,
    major ? `I'm planning to study ${major}.` : "",
    schools.length ? `I'm applying to ${schools.length} ${schools.length === 1 ? "school" : "schools"}: ${schools.map((a) => a.name).join(", ")}.` : "",
    earliest ? `The earliest deadline is ${earliest}, so a letter a week or two before then would be wonderful.` : "",
    "I've attached a short brag sheet with my activities and a few moments from your class that might help. I'm happy to meet or answer any questions.",
    "",
    "Thank you so much for considering this.",
    "",
    student,
  ].filter((l, i, all) => l !== "" || (all[i - 1] ?? "") !== "");
  const outline = [
    "",
    "--- Brag sheet outline ---",
    major ? `Intended major: ${major}` : "Intended major: [fill in]",
    subject ? `What I did in ${subject}: [a project, a question you asked, how you grew]` : "What I did in your class: [a project, a question you asked, how you grew]",
    "Top activities:",
    ...(activities.length
      ? activities.map((a) => `- ${a.name}${a.role ? `, ${a.role}` : ""}${a.org ? ` (${a.org})` : ""}${a.hpw ? `, ${a.hpw} hrs/week` : ""}`)
      : ["- [activity, your role, hours per week]"]),
    "Something you might not know about me: [fill in]",
    "Schools and deadlines:",
    ...(schools.length ? schools.map((a) => `- ${a.name}${a.deadline ? `: ${a.deadline}` : ""}`) : ["- [school: deadline]"]),
  ];
  return [...lines, ...outline].join("\n");
}
