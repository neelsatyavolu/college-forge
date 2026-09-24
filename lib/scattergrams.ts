// Maia Learning scattergrams imported by the student's own bookmarklet run.
// Each point is a past applicant from the student's high school, so this data
// lives in its own storage key (see lib/store.ts) and is never shared.

export type ScatterPoint = { sat: number | null; gpa: number | null; result: string; round: string | null };
export type ScatterStats = { gpa: number | null; sat: number | null };
export type StudentMarker = { gpa: number | null; wgpa: number | null; sat: number | null };

export type CollegeScattergram = {
  slug: string;
  name: string;
  /** U.S. News rank at import time, when the school is in the top 250. */
  rank?: number | null;
  maiaTitle: string | null;
  fetchedAt: number;
  n: number;
  counts: Record<string, number>;
  averages: ScatterStats;
  points: ScatterPoint[];
};

export type ScattergramDoc = {
  version: 1;
  importedAt: number;
  classOfYears: string | null;
  student: StudentMarker | null;
  colleges: Record<string, CollegeScattergram>;
};

export const MAX_IMPORT_COLLEGES = 300;
export const MAX_POINTS_PER_COLLEGE = 5000;
export const MAX_POINTS_PER_IMPORT = 50_000;
const MAX_ROUND = 40;
const RESULTS = ["Accepted", "Denied", "Waitlisted", "Deferred"];

export class ScattergramInputError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

const sat = (v: unknown) => {
  const n = numberIn(v, 400, 1600);
  return n === null ? null : Math.round(n);
};
const gpa = (v: unknown) => numberIn(v, 0, 5);

function label(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

/** Collapse free-text outcomes to a fixed set so counts stay small and safe as object keys. */
function result(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return RESULTS.find((r) => r.toLowerCase() === text) || "Other";
}

function sanitizePoint(value: unknown): ScatterPoint | null {
  if (!isObject(value)) return null;
  const point = { sat: sat(value.sat), gpa: gpa(value.gpa), result: result(value.result), round: label(value.round, MAX_ROUND) };
  return point.sat === null && point.gpa === null ? null : point;
}

function countResults(points: ScatterPoint[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const p of points) counts.set(p.result, (counts.get(p.result) || 0) + 1);
  return Object.fromEntries(counts);
}

function sanitizeStudent(value: unknown): StudentMarker | null {
  if (!isObject(value)) return null;
  const marker = { gpa: gpa(value.gpa), wgpa: numberIn(value.wgpa, 0, 6), sat: sat(value.sat) };
  return marker.gpa === null && marker.wgpa === null && marker.sat === null ? null : marker;
}

export type ImportResult = { doc: ScattergramDoc; skipped: string[] };

export type ImportableCollege = { slug: string; name: string; rank?: number | null };

/**
 * Validate an import body and merge it over the existing doc. Only `allowed`
 * colleges (by slug) are stored; the name and rank come from `allowed`, and a
 * later entry with the same slug wins.
 */
export function applyScattergramImport(
  existing: ScattergramDoc | null,
  body: unknown,
  allowed: ImportableCollege[],
  now = Date.now()
): ImportResult {
  if (!isObject(body)) throw new ScattergramInputError("A JSON object is required.");
  const incoming = body.colleges;
  if (!Array.isArray(incoming) || incoming.length === 0) throw new ScattergramInputError("colleges must be a non-empty array.");
  if (incoming.length > MAX_IMPORT_COLLEGES) throw new ScattergramInputError(`At most ${MAX_IMPORT_COLLEGES} colleges per import.`);
  const total = incoming.reduce((sum, entry) => sum + (isObject(entry) && Array.isArray(entry.points) ? entry.points.length : 0), 0);
  if (total > MAX_POINTS_PER_IMPORT) throw new ScattergramInputError("Too many points in one import.");

  const known = new Map(allowed.map((c) => [c.slug, c]));
  const skipped: string[] = [];
  const imported: Record<string, CollegeScattergram> = {};
  for (const entry of incoming) {
    if (!isObject(entry) || typeof entry.slug !== "string") throw new ScattergramInputError("Each college needs a slug.");
    const points = entry.points ?? [];
    if (!Array.isArray(points)) throw new ScattergramInputError(`points for ${entry.slug} must be an array.`);
    if (points.length > MAX_POINTS_PER_COLLEGE) throw new ScattergramInputError(`Too many points for ${entry.slug}.`);
    const college = known.get(entry.slug);
    if (!college) {
      skipped.push(entry.slug.slice(0, 80));
      continue;
    }
    const clean = points.map(sanitizePoint).filter((p): p is ScatterPoint => p !== null);
    const averages = isObject(entry.averages) ? { gpa: gpa(entry.averages.gpa), sat: sat(entry.averages.sat) } : { gpa: null, sat: null };
    imported[entry.slug] = {
      slug: entry.slug,
      name: college.name,
      rank: college.rank ?? null,
      maiaTitle: label(entry.maiaTitle, 160),
      fetchedAt: now,
      n: clean.length,
      counts: countResults(clean),
      averages,
      points: clean,
    };
  }

  const classOfYears = label(body.classOfYears, 4);
  // Drop data for colleges that are no longer importable (e.g. removed from the list).
  const kept = Object.fromEntries(Object.entries(existing?.colleges || {}).filter(([slug]) => known.has(slug)));
  return {
    skipped,
    doc: {
      version: 1,
      importedAt: now,
      classOfYears: classOfYears ?? existing?.classOfYears ?? null,
      student: sanitizeStudent(body.student) ?? existing?.student ?? null,
      colleges: { ...kept, ...imported },
    },
  };
}

export function decodeScattergramDoc(raw: string | null): ScattergramDoc | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) && parsed.version === 1 && isObject(parsed.colleges) ? (parsed as ScattergramDoc) : null;
  } catch {
    return null;
  }
}
