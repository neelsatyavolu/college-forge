/**
 * How first-year students enter each college's BSN, from the college's own admissions or nursing pages
 * (researched and sourced; see public/data/nursing-admission.json). "direct" means the nursing seat comes
 * with admission; "competitive" means pre-nursing first, then a limited-seat application.
 */
import data from "../public/data/nursing-admission.json";

export type NursingEntry = "direct" | "competitive" | "both" | "none";
export type NursingAdmission = { entry: NursingEntry | null; note: string; sourceUrl: string | null };

const COLLEGES = (data as { colleges: Record<string, NursingAdmission> }).colleges;

/** Whether the student's intended major is nursing. */
export function wantsNursing(intended: string | undefined): boolean {
  return /\bnurs(e|ing)\b|\bBSN\b|\bRN\b/i.test(intended || "");
}

export function nursingAdmission(slug: string | undefined | null): NursingAdmission | null {
  const found = slug ? COLLEGES[slug] : undefined;
  return found && found.entry ? found : null;
}

/** One line for the list: how a first-year gets into nursing there. */
export function nursingLabel(n: NursingAdmission | null): string | null {
  if (!n?.entry) return null;
  const word = { direct: "Direct admit to nursing as a first-year", competitive: "Pre-nursing first; competitive entry to the nursing major later", both: "Some direct-admit nursing seats; others apply later", none: "No four-year first-year BSN" }[n.entry];
  return `${word}${n.note ? `: ${n.note}` : ""}`;
}
