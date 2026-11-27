/**
 * Unweighted GPA by school year (applicant.gpaByYear) and what follows from it: the grade trend across high
 * school and the 10th-11th grade GPA the UCs use. With two or more years on file these replace whatever trend
 * and recent GPA were typed in, so an upward run shows wherever Forge reads applicant.gpaTrend / gpaRecent.
 */
import type { Workspace } from "./store";

export type GpaYear = "9" | "10" | "11" | "12";
export type GpaByYear = Partial<Record<GpaYear, string>>;

const YEARS: GpaYear[] = ["9", "10", "11", "12"];
/** How far the latest year must sit from the earliest to count as a trend, fixed in advance. */
const TREND_STEP = 0.15;

function gpa(value: string | undefined): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= 0 && n <= 4 ? n : null;
}

/** The trend from the earliest to the latest year on file, and the 10th-11th average; null with fewer than two years. */
export function gpaFromYears(byYear: GpaByYear | undefined): { trend: "up" | "steady" | "down"; recent: string | null } | null {
  if (!byYear) return null;
  const known = YEARS.map((y) => ({ y, v: gpa(byYear[y]) })).filter((x): x is { y: GpaYear; v: number } => x.v !== null);
  if (known.length < 2) return null;
  const change = known[known.length - 1].v - known[0].v;
  const trend = change >= TREND_STEP - 1e-9 ? "up" : change <= -TREND_STEP + 1e-9 ? "down" : "steady";
  const tenth = gpa(byYear["10"]);
  const eleventh = gpa(byYear["11"]);
  const recent = tenth !== null && eleventh !== null ? String(Math.round(((tenth + eleventh) * 100) / 2) / 100) : null;
  return { trend, recent };
}

/** The workspace with gpaTrend and gpaRecent set from gpaByYear; the same object when nothing changes. */
export function withGpaFromYears<T extends Pick<Workspace, "applicant">>(ws: T): T {
  const derived = gpaFromYears(ws.applicant?.gpaByYear);
  if (!derived) return ws;
  const recent = derived.recent ?? ws.applicant.gpaRecent;
  if (ws.applicant.gpaTrend === derived.trend && ws.applicant.gpaRecent === recent) return ws;
  return { ...ws, applicant: { ...ws.applicant, gpaTrend: derived.trend, ...(recent ? { gpaRecent: recent } : {}) } };
}
