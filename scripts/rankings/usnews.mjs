/**
 * Pure helpers for the U.S. News National Universities refresh: parse one
 * search-API item, merge it with College Scorecard admissions data and the
 * previous dataset, and render lib/us-news-rankings.ts.
 */

export const SEARCH_URL = "https://www.usnews.com/best-colleges/api/search";

export function searchPageUrl(page) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("schoolType", "national-universities");
  url.searchParams.set("_sort", "rank");
  url.searchParams.set("_sortDirection", "asc");
  url.searchParams.set("_page", String(page));
  return url.toString();
}

/** Same rules as slugify() in lib/colleges.ts, so new rows match search hits. */
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

const numberOrNull = (v) => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

/** "1520-1580" → [1520, 1580]; anything else → [null, null]. */
export function parseSatRange(text) {
  const m = String(text ?? "").match(/(\d{3,4})\s*[-–]\s*(\d{3,4})/);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

/** One search-API item → the fields U.S. News owns, or null if unranked. */
export function parseItem(item) {
  const inst = item?.institution;
  const rank = inst?.rankingSortRank;
  if (!inst || inst.rankingRankStatus !== "ranked" || !Number.isInteger(rank) || rank <= 0) return null;
  const scorecardId = Number(inst.xwalkId);
  const search = item.searchData || {};
  const [sat25, sat75] = parseSatRange(search.satAvg?.displayValue);
  const gpa = numberOrNull(search.hsGpaAvg?.rawValue);
  const accept = numberOrNull(search.acceptanceRate?.rawValue);
  return {
    name: String(inst.displayName || "").trim(),
    rank,
    city: String(inst.city || "").trim(),
    state: String(inst.state || "").trim(),
    scorecardId: Number.isInteger(scorecardId) && scorecardId > 0 ? scorecardId : null,
    photo: inst.primaryPhotoCardLarge || inst.primaryPhotoMedium || null,
    gpa,
    // U.S. News reports some averages on a weighted scale; above 4.0 is unambiguous.
    gpaWeighted: typeof gpa === "number" && (gpa > 4 || /weighted/i.test(search.hsGpaAvg?.noteText || "")),
    admitRate: accept === null ? null : accept / 100,
    sat25,
    sat75,
  };
}

/** Scorecard school.locale → [setting bucket, NCES locale label]. */
export const LOCALES = {
  11: ["urban", "City: Large"], 12: ["urban", "City: Midsize"], 13: ["urban", "City: Small"],
  21: ["suburban", "Suburb: Large"], 22: ["suburban", "Suburb: Midsize"], 23: ["suburban", "Suburb: Small"],
  31: ["town", "Town: Fringe"], 32: ["town", "Town: Distant"], 33: ["town", "Town: Remote"],
  41: ["rural", "Rural: Fringe"], 42: ["rural", "Rural: Distant"], 43: ["rural", "Rural: Remote"],
};

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * Build the dataset row. Scorecard supplies admit rate, SAT band and campus
 * setting (the fields the rest of Forge already reads from it); U.S. News
 * values fill Scorecard gaps. Slugs of schools already in the dataset are kept
 * so saved workspaces still match.
 */
export function buildRow(usn, { scorecard, previous }) {
  const locale = LOCALES[scorecard?.locale] || null;
  const setting = locale?.[0] ?? previous?.setting ?? null;
  const admitRate = scorecard?.admitRate ?? usn.admitRate;
  return {
    slug: previous?.slug || slugify(usn.name),
    name: usn.name,
    rank: usn.rank,
    city: usn.city,
    state: usn.state,
    setting,
    settingDetail: locale?.[1] ?? previous?.settingDetail ?? "",
    admitRate: typeof admitRate === "number" ? round4(admitRate) : null,
    sat25: scorecard?.sat25 ?? usn.sat25,
    sat75: scorecard?.sat75 ?? usn.sat75,
    gpa: usn.gpa,
    gpaWeighted: usn.gpaWeighted,
    photo: usn.photo,
    scorecardId: usn.scorecardId,
  };
}

/**
 * Same-named schools (University of St. Thomas in MN and TX) get the state
 * appended; saved workspaces still resolve them by Scorecard id.
 */
export function disambiguateSlugs(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.slug, (counts.get(r.slug) || 0) + 1);
  return rows.map((r) => (counts.get(r.slug) > 1 ? { ...r, slug: `${r.slug}-${r.state.toLowerCase()}` } : r));
}

/** Problems that should stop a refresh from overwriting good data. */
export function validateRows(rows, { maxRank, minRows }) {
  const problems = [];
  if (rows.length < minRows) problems.push(`only ${rows.length} ranked schools (expected at least ${minRows})`);
  const seen = new Map();
  for (const r of rows) {
    if (r.rank > maxRank) problems.push(`${r.name}: rank ${r.rank} is past the cutoff ${maxRank}`);
    if (!r.setting) problems.push(`${r.name}: no campus setting`);
    for (const key of ["slug", "scorecardId"]) {
      const id = `${key}:${r[key]}`;
      if (seen.has(id)) problems.push(`${r.name}: duplicate ${key} with ${seen.get(id)}`);
      seen.set(id, r.name);
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].rank < rows[i - 1].rank) problems.push(`${rows[i].name}: out of rank order`);
  }
  return problems;
}

/** Fall release N ranks the "N+1 Best Colleges" edition. */
export function editionFor(date) {
  return String(date.getUTCFullYear() + (date.getUTCMonth() >= 6 ? 1 : 0));
}

export function renderModule(rows, { edition, fetchedOn, maxRank }) {
  return `// U.S. News National Universities ranking (${edition} edition) + Scorecard ids + campus photos.
// Generated by scripts/fetch-usnews-rankings.mjs on ${fetchedOn} — do not edit by hand.
// Rank ≤ ${maxRank} (ties mean a few more schools). Rank, name, location, GPA and
// photo come from U.S. News; admit rate, SAT band and setting from College Scorecard.
// Photos are local under /public/colleges when present, otherwise the U.S. News CDN.

export type UsNewsCollege = {
  slug: string;
  name: string;
  rank: number;
  city: string;
  state: string;
  setting: "urban" | "suburban" | "town" | "rural";
  settingDetail: string;
  admitRate: number | null;
  sat25: number | null;
  sat75: number | null;
  gpa: number | null;
  gpaWeighted: boolean;
  photo: string | null;
  scorecardId: number;
};

/** The "Best Colleges" edition year these ranks come from. */
export const US_NEWS_EDITION = ${JSON.stringify(edition)};

export const US_NEWS_TOP_250: UsNewsCollege[] = ${JSON.stringify(rows, null, 2)};


/** @deprecated use US_NEWS_TOP_250 */
export const US_NEWS_TOP_100 = US_NEWS_TOP_250;

/** scorecardId → US News entry (for enriching Scorecard search hits). */
export const US_NEWS_BY_SCORECARD_ID = new Map(
  US_NEWS_TOP_250.map((c) => [c.scorecardId, c] as const)
);

/** slug → US News entry */
export const US_NEWS_BY_SLUG = new Map(
  US_NEWS_TOP_250.map((c) => [c.slug, c] as const)
);
`;
}

/** Markdown summary for the review PR: movers, arrivals, departures. */
export function renderReport(rows, previous, { edition }) {
  const before = new Map(previous.map((r) => [r.scorecardId, r]));
  const after = new Set(rows.map((r) => r.scorecardId));
  const added = rows.filter((r) => !before.has(r.scorecardId));
  const dropped = previous.filter((r) => !after.has(r.scorecardId));
  const moved = rows
    .filter((r) => before.has(r.scorecardId))
    .map((r) => ({ ...r, delta: before.get(r.scorecardId).rank - r.rank }))
    .filter((r) => Math.abs(r.delta) >= 10)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const line = (r) => `- #${r.rank} ${r.name}`;
  return [
    `# U.S. News National Universities — ${edition} edition`,
    "",
    `${rows.length} schools ranked ≤ cutoff. Top 10:`,
    "",
    ...rows.slice(0, 10).map(line),
    "",
    `## New to the list (${added.length})`,
    "",
    ...(added.length ? added.map(line) : ["- none"]),
    "",
    `## Dropped off (${dropped.length})`,
    "",
    ...(dropped.length ? dropped.map((r) => `- was #${r.rank} ${r.name}`) : ["- none"]),
    "",
    `## Moved 10+ places (${moved.length})`,
    "",
    ...(moved.length ? moved.map((r) => `- #${r.rank} ${r.name} (${r.delta > 0 ? "▲" : "▼"}${Math.abs(r.delta)})`) : ["- none"]),
    "",
  ].join("\n");
}
