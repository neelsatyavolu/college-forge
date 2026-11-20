/**
 * Admission rate and SAT middle 50% for tracked schools, from the federal College Scorecard. Tracker
 * schools come from the portal catalog, which has no admissions numbers, so chance estimates look them
 * up once and keep them in the workspace (`schoolStats`).
 */

import { collegeById } from "./catalog";
import type { TrackedApp } from "./tracker";

export type SchoolStats = { admit?: string; satRange?: string; scorecardId?: number; checkedAt: string };

const ENDPOINT = "https://api.data.gov/ed/collegescorecard/v1/schools.json";
const FIELDS = [
  "id", "school.name", "school.school_url",
  "latest.admissions.admission_rate.overall",
  "latest.admissions.sat_scores.25th_percentile.critical_reading", "latest.admissions.sat_scores.25th_percentile.math",
  "latest.admissions.sat_scores.75th_percentile.critical_reading", "latest.admissions.sat_scores.75th_percentile.math",
].join(",");
const TIMEOUT_MS = 10_000;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// "Indiana University-Bloomington" and "Washington University in St Louis" match the catalog's spelling.
const plain = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const host = (u: unknown) => String(u ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

/** The row for this school: same website first, else the exact name, else nothing (a wrong school is worse than none). */
export function pickRow(rows: Row[], name: string, website: string): Row | null {
  const site = host(website);
  const bySite = site ? rows.find((r) => host(r["school.school_url"]) === site) : undefined;
  if (bySite) return bySite;
  const n = plain(name);
  return rows.find((r) => plain(r["school.name"]) === n) ?? null;
}

export function statsFromRow(r: Row, now: string): SchoolStats {
  const rate = num(r["latest.admissions.admission_rate.overall"]);
  const lo = [num(r["latest.admissions.sat_scores.25th_percentile.critical_reading"]), num(r["latest.admissions.sat_scores.25th_percentile.math"])];
  const hi = [num(r["latest.admissions.sat_scores.75th_percentile.critical_reading"]), num(r["latest.admissions.sat_scores.75th_percentile.math"])];
  const sat = lo.every((x) => x !== null) && hi.every((x) => x !== null) ? `${lo[0]! + lo[1]!}–${hi[0]! + hi[1]!}` : undefined;
  return {
    admit: rate !== null && rate > 0 ? `${Math.round(rate * 1000) / 10}%` : undefined,
    satRange: sat,
    scorecardId: num(r.id) ?? undefined,
    checkedAt: now,
  };
}

export async function lookupStats(app: TrackedApp, now: string): Promise<SchoolStats | null> {
  const key = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!key) return null;
  const catalog = app.collegeId ? collegeById(app.collegeId) : undefined;
  const name = catalog?.name || app.name;
  const url = new URL(ENDPOINT);
  url.searchParams.set("api_key", key);
  url.searchParams.set("school.name", name);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("per_page", "20");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: Row[] };
    const row = pickRow(body.results ?? [], name, catalog?.website || "");
    return row ? statsFromRow(row, now) : { checkedAt: now };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
