#!/usr/bin/env node
/**
 * Refresh lib/us-news-rankings.ts from U.S. News' National Universities list.
 *
 *   node --env-file=.env.local scripts/fetch-usnews-rankings.mjs [--max-rank 250] [--dry-run] [--report out.md]
 *
 * Pages the public search API behind usnews.com/best-colleges (robots.txt
 * allows it), joins each school to College Scorecard by the IPEDS id U.S. News
 * publishes, and rewrites the dataset. Requires COLLEGE_SCORECARD_API_KEY.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFetcher } from "./supplements/http.mjs";
import { buildRow, disambiguateSlugs, editionFor, parseItem, renderModule, renderReport, searchPageUrl, validateRows } from "./rankings/usnews.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const RANKINGS = root("lib/us-news-rankings.ts");
const PHOTO_EXTS = ["jpg", "png", "webp"];
const MAX_PAGES = 60;
const SCORECARD_BATCH = 100;
// usnews.com's CDN stalls requests without a browser user agent.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const maxRank = Number(opt("--max-rank") ?? 250);
  if (!Number.isInteger(maxRank) || maxRank < 10) throw new Error("--max-rank must be an integer ≥ 10");
  return { maxRank, dryRun: argv.includes("--dry-run"), report: opt("--report") };
}

async function loadPrevious() {
  const src = await readFile(RANKINGS, "utf8");
  const start = src.indexOf("= [", src.indexOf("US_NEWS_TOP_250: "));
  const end = src.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error(`Could not find US_NEWS_TOP_250 array in ${RANKINGS}`);
  return JSON.parse(src.slice(start + 2, end + 2));
}

async function fetchRanked(http, maxRank) {
  const ranked = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await http.get(searchPageUrl(page));
    if (res.status !== 200) throw new Error(`U.S. News page ${page}: ${res.error || `HTTP ${res.status}`}`);
    const data = JSON.parse(res.text).data;
    const items = (data?.items || []).map(parseItem).filter(Boolean);
    ranked.push(...items.filter((r) => r.rank <= maxRank));
    process.stdout.write(`\rU.S. News page ${page}: ${ranked.length} schools`);
    const pastCutoff = items.length > 0 && items.every((r) => r.rank > maxRank);
    if (pastCutoff || !data?.hasNextPage) break;
  }
  process.stdout.write("\n");
  return ranked;
}

const sum = (a, b) => (typeof a === "number" && typeof b === "number" ? a + b : null);

async function fetchScorecard(ids, apiKey) {
  const fields = [
    "id",
    "school.locale",
    "latest.admissions.admission_rate.overall",
    "latest.admissions.sat_scores.25th_percentile.critical_reading",
    "latest.admissions.sat_scores.25th_percentile.math",
    "latest.admissions.sat_scores.75th_percentile.critical_reading",
    "latest.admissions.sat_scores.75th_percentile.math",
  ];
  const out = new Map();
  for (let i = 0; i < ids.length; i += SCORECARD_BATCH) {
    const url = new URL("https://api.data.gov/ed/collegescorecard/v1/schools.json");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("id", ids.slice(i, i + SCORECARD_BATCH).join(","));
    url.searchParams.set("fields", fields.join(","));
    url.searchParams.set("per_page", String(SCORECARD_BATCH));
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`College Scorecard HTTP ${res.status}`);
    for (const r of (await res.json()).results || []) {
      const rate = r["latest.admissions.admission_rate.overall"];
      out.set(r.id, {
        locale: r["school.locale"],
        admitRate: typeof rate === "number" ? rate : null,
        sat25: sum(r["latest.admissions.sat_scores.25th_percentile.critical_reading"], r["latest.admissions.sat_scores.25th_percentile.math"]),
        sat75: sum(r["latest.admissions.sat_scores.75th_percentile.critical_reading"], r["latest.admissions.sat_scores.75th_percentile.math"]),
      });
    }
  }
  return out;
}

async function localPhoto(slug) {
  for (const ext of PHOTO_EXTS) {
    try {
      await access(root(`public/colleges/${slug}.${ext}`));
      return `/colleges/${slug}.${ext}`;
    } catch {}
  }
  return null;
}

async function main() {
  const { maxRank, dryRun, report } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!apiKey) throw new Error("COLLEGE_SCORECARD_API_KEY is not set (try node --env-file=.env.local …)");

  const previous = await loadPrevious();
  const prevById = new Map(previous.map((r) => [r.scorecardId, r]));
  const http = createFetcher({ userAgent: BROWSER_UA, perHostDelayMs: 1500 });

  const ranked = await fetchRanked(http, maxRank);
  const unmatched = ranked.filter((r) => !r.scorecardId);
  for (const r of unmatched) console.warn(`skipping #${r.rank} ${r.name}: no IPEDS id`);
  const usable = ranked.filter((r) => r.scorecardId);

  const scorecard = await fetchScorecard(usable.map((r) => r.scorecardId), apiKey);
  const built = disambiguateSlugs(usable.map((usn) =>
    buildRow(usn, { scorecard: scorecard.get(usn.scorecardId), previous: prevById.get(usn.scorecardId) })));
  const rows = [];
  for (const row of built) rows.push({ ...row, photo: (await localPhoto(row.slug)) || row.photo });

  const problems = validateRows(rows, { maxRank, minRows: Math.round(maxRank * 0.9) });
  if (problems.length) throw new Error(`Refusing to write the dataset:\n  ${problems.join("\n  ")}`);

  const now = new Date();
  const edition = editionFor(now);
  const summary = renderReport(rows, previous, { edition });
  console.log(summary);
  if (report) await writeFile(report, summary);
  if (dryRun) return;
  await writeFile(RANKINGS, renderModule(rows, { edition, fetchedOn: now.toISOString().slice(0, 10), maxRank }));
  console.log(`Wrote ${rows.length} schools to lib/us-news-rankings.ts`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
