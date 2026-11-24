#!/usr/bin/env node
/**
 * Refresh lib/us-news-rankings.ts from U.S. News' National Universities list
 * and the top of its National Liberal Arts Colleges list.
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
import {
  LIBERAL_ARTS,
  NATIONAL,
  buildLacRow,
  buildRow,
  disambiguateSlugs,
  editionFor,
  parseItem,
  renderModule,
  renderReport,
  searchPageUrl,
  validateRows,
} from "./rankings/usnews.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const RANKINGS = root("lib/us-news-rankings.ts");
const PHOTO_EXTS = ["jpg", "png", "webp"];
const MAX_PAGES = 60;
const SCORECARD_BATCH = 100;
/** Liberal arts colleges kept: the top 50, the set lib/catalog/lac.ts covers. */
const LAC_MAX_RANK = 50;
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

async function loadPrevious(name = "US_NEWS_TOP_250") {
  const src = await readFile(RANKINGS, "utf8");
  const at = src.indexOf(`${name}: `);
  if (at < 0 && name !== "US_NEWS_TOP_250") return [];
  const start = src.indexOf("= [", at);
  const end = src.indexOf("\n];", start);
  if (at < 0 || start < 0 || end < 0) throw new Error(`Could not find ${name} array in ${RANKINGS}`);
  return JSON.parse(src.slice(start + 2, end + 2));
}

async function fetchRanked(http, maxRank, schoolType = NATIONAL) {
  const ranked = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await http.get(searchPageUrl(page, schoolType));
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
    "school.name",
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
        name: r["school.name"],
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

/** Top liberal arts colleges, slugged by their Scorecard names; saved slugs are kept. */
async function fetchLiberalArts(http, apiKey) {
  const previous = new Map((await loadPrevious("US_NEWS_LAC_TOP_N")).map((r) => [r.scorecardId, r]));
  const ranked = (await fetchRanked(http, LAC_MAX_RANK, LIBERAL_ARTS)).filter((r) => r.scorecardId);
  const scorecard = await fetchScorecard(ranked.map((r) => r.scorecardId), apiKey);
  const rows = disambiguateSlugs(
    ranked.map((usn) => buildLacRow(usn, { scorecardName: scorecard.get(usn.scorecardId)?.name, previous: previous.get(usn.scorecardId) }))
  );
  const problems = validateRows(rows, { maxRank: LAC_MAX_RANK, minRows: Math.round(LAC_MAX_RANK * 0.9), requireSetting: false });
  if (problems.length) throw new Error(`Refusing to write the liberal arts list:\n  ${problems.join("\n  ")}`);
  return rows;
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

  const lacRows = await fetchLiberalArts(http, apiKey);

  const now = new Date();
  const edition = editionFor(now);
  const summary = renderReport(rows, previous, { edition });
  console.log(summary);
  if (report) await writeFile(report, summary);
  if (dryRun) return;
  const fetchedOn = now.toISOString().slice(0, 10);
  await writeFile(RANKINGS, renderModule(rows, { edition, fetchedOn, maxRank, lacRows, lacMaxRank: LAC_MAX_RANK }));
  console.log(`Wrote ${rows.length} schools to lib/us-news-rankings.ts`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
