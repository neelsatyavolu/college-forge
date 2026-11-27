// What the AI features see of the student's imported Maia scattergrams: per-school
// counts, accepted medians, early-round results and how applicants near the student's
// own GPA and SAT fared. Points are anonymous (no names), but they describe real
// classmates, so this stays out of share links and exports like the raw file does.
import type { Workspace } from "./store";
import { decodeScattergramDoc, type CollegeScattergram, type ScatterPoint, type ScattergramDoc } from "./scattergrams";
import { readScattergramText } from "./store";

/** "Near you": within this much unweighted GPA and SAT of the student. */
const NEAR_GPA = 0.1;
const NEAR_SAT = 50;
const MAX_DIGEST_SCHOOLS = 40;
const MAX_POINTS_RETURNED = 400;

export type StudentPoint = { gpa: number; sat: number; from: "maia" | "profile" };

export type ScatterSummary = {
  slug: string;
  name: string;
  applicants: number;
  results: Record<string, number>;
  admit_rate_percent: number | null;
  accepted_median: { gpa: number | null; sat: number | null };
  accepted_lowest_plotted: { gpa: number | null; sat: number | null };
  maia_average: { gpa: number | null; sat: number | null };
  early: { ed?: { applicants: number; accepted: number }; ea?: { applicants: number; accepted: number } };
  near_student: { applicants: number; accepted: number; denied: number; waitlisted: number; deferred: number } | null;
};

export async function loadScattergrams(workspaceId: string): Promise<ScattergramDoc | null> {
  try {
    return decodeScattergramDoc(await readScattergramText(workspaceId));
  } catch {
    return null;
  }
}

/** First number in a profile field, e.g. "3.9/4.0" → 3.9, "1,500" → 1500. */
function firstNumber(value: unknown): number | null {
  const m = String(value ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** The student's own point: Maia's marker when it has both numbers, else the Forge profile. */
export function studentPoint(doc: ScattergramDoc | null, ws: Workspace): StudentPoint | null {
  const m = doc?.student;
  if (m?.gpa != null && m?.sat != null) return { gpa: m.gpa, sat: m.sat, from: "maia" };
  const gpa = firstNumber(ws.applicant?.gpaUnweighted);
  // Empty fields hold "—", so take the first one that has a number.
  const sat = firstNumber(ws.profile?.testing?.sat) ?? firstNumber(ws.applicant?.sat);
  return gpa != null && gpa <= 5 && sat != null && sat >= 400 && sat <= 1600 ? { gpa, sat, from: "profile" } : null;
}

/** Maia's round labels vary ("Early Decision II", "ED2", "REA"), so match loosely. */
export function roundKind(round: string | null): "ed" | "ea" | null {
  const r = String(round || "").toLowerCase();
  if (/early decision|\bed\s*(i{1,2}|[12])?\b/.test(r)) return "ed";
  if (/early action|\b(r|sc)?ea\b/.test(r)) return "ea";
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

const nums = (points: ScatterPoint[], key: "gpa" | "sat") => points.map((p) => p[key]).filter((v): v is number => v != null);
const minOf = (v: number[]) => (v.length ? Math.min(...v) : null);

export function summarizeCollege(c: CollegeScattergram, student: StudentPoint | null): ScatterSummary {
  const accepted = c.points.filter((p) => p.result === "Accepted");
  const early: ScatterSummary["early"] = {};
  for (const kind of ["ed", "ea"] as const) {
    const round = c.points.filter((p) => roundKind(p.round) === kind);
    if (round.length) early[kind] = { applicants: round.length, accepted: round.filter((p) => p.result === "Accepted").length };
  }
  const near = student
    ? c.points.filter((p) => p.gpa != null && p.sat != null && Math.abs(p.gpa - student.gpa) <= NEAR_GPA && Math.abs(p.sat - student.sat) <= NEAR_SAT)
    : null;
  const count = (list: ScatterPoint[], r: string) => list.filter((p) => p.result === r).length;
  return {
    slug: c.slug,
    name: c.name,
    applicants: c.n,
    results: c.counts,
    admit_rate_percent: c.n ? Math.round(((c.counts.Accepted || 0) / c.n) * 100) : null,
    accepted_median: { gpa: median(nums(accepted, "gpa")), sat: median(nums(accepted, "sat")) },
    accepted_lowest_plotted: { gpa: minOf(nums(accepted, "gpa")), sat: minOf(nums(accepted, "sat")) },
    maia_average: c.averages,
    early,
    near_student: near
      ? { applicants: near.length, accepted: count(near, "Accepted"), denied: count(near, "Denied"), waitlisted: count(near, "Waitlisted"), deferred: count(near, "Deferred") }
      : null,
  };
}

/** One plain line for a prompt. */
export function summaryLine(s: ScatterSummary): string {
  if (!s.applicants) return `${s.name}: no past applicants from the student's school`;
  const parts = [`${s.applicants} applicants, ${s.results.Accepted || 0} accepted (${s.admit_rate_percent}%)`];
  const { gpa, sat } = s.accepted_median;
  if (gpa != null || sat != null) parts.push(`accepted median GPA ${gpa ?? "—"} / SAT ${sat ?? "—"}`);
  if (s.early.ed) parts.push(`ED ${s.early.ed.accepted} of ${s.early.ed.applicants} accepted`);
  if (s.early.ea) parts.push(`EA ${s.early.ea.accepted} of ${s.early.ea.applicants} accepted`);
  if (s.near_student) {
    const n = s.near_student;
    parts.push(n.applicants ? `near the student's stats: ${n.applicants} (${n.accepted} accepted, ${n.denied} denied, ${n.waitlisted} waitlisted)` : "none near the student's stats");
  }
  return `${s.name}: ${parts.join("; ")}`;
}

/** List schools first, then the rest, for the copilot's system prompt. Empty when nothing is imported. */
export function scattergramDigest(doc: ScattergramDoc | null, ws: Workspace): string {
  if (!doc || !Object.keys(doc.colleges).length) return "";
  const student = studentPoint(doc, ws);
  const onList = new Set(ws.colleges.map((c) => c.slug));
  const all = Object.values(doc.colleges);
  const ordered = [...all.filter((c) => onList.has(c.slug)), ...all.filter((c) => !onList.has(c.slug)).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))];
  const lines = ordered.slice(0, MAX_DIGEST_SCHOOLS).map((c) => `- ${onList.has(c.slug) ? "" : "(not on list) "}${summaryLine(summarizeCollege(c, student))}`);
  const missing = ws.colleges.filter((c) => !doc.colleges[c.slug]).map((c) => c.short || c.name);
  return [
    `Imported ${new Date(doc.importedAt).toISOString().slice(0, 10)}${doc.classOfYears ? `, last ${doc.classOfYears} graduating classes` : ""}; ${all.length} schools.` +
      (student ? ` The student's point: GPA ${student.gpa} unweighted, SAT ${student.sat} (from ${student.from === "maia" ? "Maia" : "the Forge profile"}).` : ""),
    ...lines,
    ...(ordered.length > MAX_DIGEST_SCHOOLS ? [`- …and ${ordered.length - MAX_DIGEST_SCHOOLS} more; call get_scattergrams.`] : []),
    ...(missing.length ? [`List schools not imported yet: ${missing.join(", ")}.`] : []),
  ].join("\n");
}

/** Finds an imported school by slug or name. */
export function findImported(doc: ScattergramDoc, school: string): CollegeScattergram | null {
  const q = school.trim().toLowerCase();
  const all = Object.values(doc.colleges);
  return doc.colleges[q] || all.find((c) => c.name.toLowerCase() === q) || all.find((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q)) || null;
}

/** The get_scattergrams tool's answer. */
export function scattergramToolResult(doc: ScattergramDoc | null, ws: Workspace, school?: string) {
  if (!doc) {
    return { imported: false, note: "No scattergrams imported. The student can import their high school's MaiaLearning scattergrams from the Scattergrams tab (a bookmark run while signed in to Maia)." };
  }
  const student = studentPoint(doc, ws);
  const base = {
    imported: true,
    imported_at: new Date(doc.importedAt).toISOString().slice(0, 10),
    class_years: doc.classOfYears,
    student,
    note: "Past applicants from the student's own high school (MaiaLearning). Small samples; a rough guide, not a prediction. Unweighted GPA.",
  };
  if (school && school.trim()) {
    const c = findImported(doc, school);
    if (!c) return { ...base, found: false, note: `No imported scattergram matches "${school.slice(0, 80)}". The student can add it from the Scattergrams tab.` };
    return { ...base, found: true, summary: summarizeCollege(c, student), points: c.points.slice(0, MAX_POINTS_RETURNED) };
  }
  const onList = new Set(ws.colleges.map((c) => c.slug));
  return {
    ...base,
    schools: Object.values(doc.colleges).map((c) => ({ ...summarizeCollege(c, student), on_list: onList.has(c.slug) })),
    list_schools_not_imported: ws.colleges.filter((c) => !doc.colleges[c.slug]).map((c) => c.name),
  };
}
