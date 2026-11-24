#!/usr/bin/env node
/**
 * Refresh supplemental essay prompts for every U.S. News top-250 national
 * university and top-30 liberal arts college by
 * scraping public web pages (no AI, no search APIs). Run yearly after
 * schools publish prompts (Aug–Sep); .github/workflows/refresh-supplements.yml
 * runs it on a schedule and opens a PR for review.
 *
 * For each school, in order:
 *   1. sources.json "noSupplements" → recorded as having none; sources.json
 *      "prompts" copied by hand for the current cycle → used as is
 *   2. sources.json "url" (last known official prompt page) → extract
 *   3. crawl from sources.json "start" or the school's Common App-listed
 *      admissions site to find the official prompt page → extract
 *   4. CollegeVine's structured prompt page, matched by name via its
 *      sitemap or pinned with sources.json "collegevine" (may lag a cycle;
 *      labeled). Its "does not require essays" notice for a past cycle
 *      records the school as having none, but only from a name match.
 *   5. nothing found → keep last run's entry, if any, and report it
 *
 * UC campuses are skipped: they share the UC Personal Insight Questions
 * already built into lib/essay-supplements.ts.
 *
 * Usage:
 *   node scripts/fetch-supplements.mjs [--only slug,slug] [--limit N]
 *     [--concurrency N] [--report path.md] [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createFetcher } from "./supplements/http.mjs";
import { extractPrompts } from "./supplements/extract.mjs";
import {
  GOOD_ENOUGH_PROMPTS,
  commonAppHome,
  discoverPromptPage,
  fetchPage,
  loadCommonAppIndex,
} from "./supplements/discover.mjs";
import { createRenderer } from "./supplements/render.mjs";
import {
  collegeVinePageMatches,
  collegeVineUrlFor,
  loadCollegeVineIndex,
  parseCollegeVine,
} from "./supplements/collegevine.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const RANKINGS = root("lib/us-news-rankings.ts");
const SOURCES = root("lib/supplements/sources.json");
const PROMPTS = root("lib/supplements/prompts.json");
const COMMON_APP_PROMPTS = root("lib/common-app-prompts.ts");
const COMMON_APP_ESSAY_PROMPTS = "https://www.commonapp.org/page-data/apply/essay-prompts/page-data.json";
const PROMPT_KEY_CHARS = 60;
const SUSPICIOUS_PROMPT_COUNT = 12;

/** Admissions cycle open on a date: Aug 2026 → "2026-27". */
export function currentCycle(date = new Date()) {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Liberal arts colleges covered by default; national universities are all covered. */
export const LAC_TOP = 30;

/** Rows of one exported array in lib/us-news-rankings.ts. */
export function readRankingArray(src, name) {
  const at = src.indexOf(`${name}: `);
  const start = src.indexOf("= [", at);
  const end = src.indexOf("\n];", start);
  if (at < 0 || start < 0 || end < 0) throw new Error(`Could not find ${name} array in ${RANKINGS}`);
  return JSON.parse(src.slice(start + 2, end + 2));
}

/** National universities, then the top LACs, deduped by slug. */
export function collegesFromRankings(src) {
  const pick = (list) => ({ slug, name, rank, scorecardId }) => ({ slug, name, rank, scorecardId, list });
  const national = readRankingArray(src, "US_NEWS_TOP_250").map(pick("national"));
  const lac = readRankingArray(src, "US_NEWS_LAC_TOP_N").filter((c) => c.rank <= LAC_TOP).map(pick("liberal-arts"));
  const seen = new Set();
  return [...national, ...lac].filter((c) => !seen.has(c.slug) && seen.add(c.slug));
}

async function loadColleges() {
  return collegesFromRankings(await readFile(RANKINGS, "utf8"));
}

const promptKey = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, PROMPT_KEY_CHARS);

/**
 * Keys for the Common App personal-statement prompts, which some schools
 * reprint: this cycle's list from Common App's essay-prompts page plus the
 * app's own copy in lib/common-app-prompts.ts.
 */
async function loadPersonalStatementKeys(http) {
  const src = await readFile(COMMON_APP_PROMPTS, "utf8");
  const local = [...src.matchAll(/prompt:\s*"((?:[^"\\]|\\.)+)"/g)].map((m) => m[1]);
  const res = await http.get(COMMON_APP_ESSAY_PROMPTS);
  const live = res.status === 200 ? [...res.text.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, "")) : [];
  if (!live.length) console.warn("Common App essay-prompts page unavailable; using lib/common-app-prompts.ts only");
  return new Set([...local, ...live].map(promptKey));
}

/** Drop reprinted Common App personal-statement prompts; they aren't supplements. */
export function withoutPersonalStatement(prompts, keys) {
  return prompts
    .map((p) => ({ ...p, options: p.options.filter((o) => !keys.has(promptKey(o))) }))
    .filter((p) => !keys.has(promptKey(p.prompt)) && (p.prompt || p.options.length));
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw new Error(`Invalid JSON in ${path}: ${err.message}`);
  }
}

/** Above this many prompts, all required usually means per-program prompts weren't detected. */
const ALL_REQUIRED_SUSPECT = 4;

export function allRequiredMany(prompts) {
  return (prompts?.length || 0) > ALL_REQUIRED_SUSPECT && prompts.every((p) => p.required);
}

const sortedObject = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

async function tryOfficial(url, ctx) {
  const page = await fetchPage(url, ctx);
  if (!page) return null;
  const result = extractPrompts(page.html);
  return result.prompts.length ? { url: page.url, result } : null;
}

const cleaned = (found, keys) => {
  if (!found) return null;
  const prompts = withoutPersonalStatement(found.result.prompts, keys);
  return prompts.length ? { ...found, result: { ...found.result, prompts } } : null;
};

async function fetchCollegeVine(college, { http, collegeVine, cycle, registry }) {
  // sources.json "collegevine" pins a page whose slug doesn't follow the school's name.
  const pinned = registry[college.slug]?.collegevine;
  const { url: cvUrl, exact } = pinned ? { url: pinned, exact: true } : collegeVineUrlFor(collegeVine, college.name, college.slug);
  const cv = await http.get(cvUrl);
  if (cv.status !== 200) return null;
  const parsed = parseCollegeVine(cv.text);
  // A guessed or abbreviated URL can land on another campus; check the page's school name.
  if (!collegeVinePageMatches(parsed.school, college.name)) return null;
  const url = cv.url || cvUrl;
  if (parsed.prompts.length) return { source: "collegevine", url, cycle: parsed.cycle, prompts: parsed.prompts };
  // "Not available yet" can't apply to a cycle that has already ended, and a
  // fuzzy match is never enough to tell students a school has no essays.
  if (exact && parsed.noEssays && parsed.cycle && parsed.cycle < cycle) {
    return { source: "none", url, cycle: parsed.cycle, note: `CollegeVine lists no essays (${parsed.cycle})` };
  }
  return null;
}

/**
 * sources.json "prompts": this cycle's prompts copied from the school's own
 * page by a person, for pages that block the scraper or that it misreads.
 * They win over scraping for that cycle and are ignored once it has passed,
 * so they can't go stale.
 */
export function copiedPrompts(reg, cycle) {
  if (!reg.prompts?.length || reg.cycle !== cycle) return null;
  const prompts = reg.prompts.map((p) => ({ unit: "words", required: true, options: [], ...p }));
  return { source: "official", url: reg.url, cycle, prompts, note: "Copied by hand from the school's page" };
}

/**
 * Returns { entry, officialCount, collegeVineCount }. An official page listing
 * fewer than half of CollegeVine's prompts is probably a summary page, so the
 * fuller (older, flagged) CollegeVine list is used instead.
 */
async function resolveSchool(college, ctx) {
  const { http, renderer, registry, commonApp, psKeys } = ctx;
  const reg = registry[college.slug] || {};
  if (reg.noSupplements) return { entry: { source: "none", note: reg.note || "sources.json" } };
  const copied = copiedPrompts(reg, ctx.cycle);
  if (copied) return { entry: copied };

  const page = { http, renderer };
  // Re-crawl unless last year's page still looks complete, so a thin or
  // stale page doesn't stay the source forever.
  const known = reg.url ? cleaned(await tryOfficial(reg.url, page), psKeys) : null;
  const start = reg.start || commonAppHome(commonApp, college.name);
  const crawled =
    known?.result.prompts.length >= GOOD_ENOUGH_PROMPTS || !start
      ? null
      : cleaned(await discoverPromptPage(start, page), psKeys);
  const found = [known, crawled].filter(Boolean).sort((a, b) => b.result.prompts.length - a.result.prompts.length)[0];
  const cv = await fetchCollegeVine(college, ctx);
  const collegeVineCount = cv?.prompts?.length ?? null;
  const officialCount = found?.result.prompts.length ?? null;
  if (found && !(cv?.source === "collegevine" && officialCount * 2 < collegeVineCount)) {
    const entry = { source: "official", url: found.url, cycle: found.result.cycle, prompts: found.result.prompts };
    return { entry, officialCount, collegeVineCount };
  }
  return { entry: cv, officialCount, collegeVineCount };
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

function buildReport({ cycle, rows, previous }) {
  const by = (pred) => rows.filter(pred);
  const official = by((r) => !r.kept && r.entry?.source === "official");
  const cv = by((r) => !r.kept && r.entry?.source === "collegevine");
  const none = by((r) => !r.kept && r.entry?.source === "none");
  const kept = by((r) => r.kept);
  const missing = by((r) => !r.entry);
  const oldCycle = by((r) => r.entry?.cycle && r.entry.cycle !== cycle);
  const noisy = by((r) => (r.entry?.prompts?.length || 0) > SUSPICIOUS_PROMPT_COUNT);
  const allRequired = by((r) => allRequiredMany(r.entry?.prompts));
  const thin = by((r) => !r.kept && r.officialCount != null && r.collegeVineCount > r.officialCount);
  const changed = by(
    (r) => r.entry && !r.kept && JSON.stringify(r.entry.prompts || []) !== JSON.stringify(previous[r.slug]?.prompts || [])
  );
  const list = (items, fmt = (r) => `- ${r.name}`) => (items.length ? items.map(fmt).join("\n") : "- none");
  return [
    `# Supplemental essay prompt refresh (${cycle})`,
    "",
    `Schools: ${rows.length} · official pages: ${official.length} · CollegeVine fallback: ${cv.length} · marked no supplements: ${none.length} · not found: ${missing.length + kept.length}`,
    "",
    "Official pages are parsed heuristically — spot-check changed schools against the linked page before merging.",
    "",
    `## Changed prompts (${changed.length})`,
    list(changed, (r) => `- ${r.name} — ${r.entry.prompts?.length ?? 0} prompts (${r.entry.source}) ${r.entry.url || ""}`),
    "",
    `## Cycle label differs from ${cycle} (${oldCycle.length})`,
    list(oldCycle, (r) => `- ${r.name} — ${r.entry.cycle} via ${r.entry.source} ${r.entry.url || ""}`),
    "",
    `## Recorded as having no supplements (${none.length})`,
    list(none, (r) => `- ${r.name} — ${r.entry.note || "sources.json"} ${r.entry.url || ""}`),
    "",
    `## Official page has fewer prompts than CollegeVine lists (${thin.length})`,
    "Under half as many → CollegeVine's list is used; otherwise the official page may be incomplete.",
    list(thin, (r) => `- ${r.name} — official ${r.officialCount} vs CollegeVine ${r.collegeVineCount}, using ${r.entry.source} ${r.entry.url}`),
    "",
    `## Unusually many prompts, likely mis-parsed (${noisy.length})`,
    list(noisy, (r) => `- ${r.name} — ${r.entry.prompts.length} prompts ${r.entry.url}`),
    "",
    `## Every prompt marked required, more than ${ALL_REQUIRED_SUSPECT} (${allRequired.length})`,
    "Program-specific prompts may be missing their audience; check the page.",
    list(allRequired, (r) => `- ${r.name} — ${r.entry.prompts.length} prompts ${r.entry.url || ""}`),
    "",
    `## Not found this run, previous entry kept (${kept.length})`,
    list(kept),
    "",
    `## Not found, no data (${missing.length})`,
    "Add a `url` (prompt page), `start` (admissions site) or `noSupplements: true` in lib/supplements/sources.json.",
    list(missing),
    "",
  ].join("\n");
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      only: { type: "string" },
      limit: { type: "string" },
      concurrency: { type: "string", default: "6" },
      report: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
  const colleges = (await loadColleges())
    .filter((c) => !c.slug.startsWith("university-of-california-"))
    .filter((c) => !only || only.has(c.slug))
    .slice(0, args.limit ? Number(args.limit) : undefined);

  const http = createFetcher();
  const renderer = createRenderer();
  const registry = await readJson(SOURCES, {});
  const previousFile = await readJson(PROMPTS, { schools: {} });
  const previous = previousFile.schools || {};
  const commonApp = await loadCommonAppIndex(http);
  if (commonApp.size === 0) console.warn("Common App index unavailable; relying on sources.json start URLs");
  const collegeVine = await loadCollegeVineIndex(http);
  if (collegeVine.size === 0) console.warn("CollegeVine sitemap unavailable; guessing its URLs from our slugs");
  const cycle = currentCycle();
  const psKeys = await loadPersonalStatementKeys(http);

  let done = 0;
  const rows = await pool(colleges, Number(args.concurrency), async (college) => {
    let entry = null;
    let officialCount = null;
    let collegeVineCount = null;
    try {
      ({ entry, officialCount, collegeVineCount } = await resolveSchool(college, {
        http,
        renderer,
        registry,
        commonApp,
        collegeVine,
        cycle,
        psKeys,
      }));
    } catch (err) {
      console.warn(`${college.slug}: ${err.message}`);
    }
    done++;
    const summary = entry ? `${entry.source} ${entry.prompts?.length ?? 0}` : "not found";
    console.log(`[${done}/${colleges.length}] ${college.slug}: ${summary}`);
    const prev = previous[college.slug];
    if (!entry && prev) {
      // Label kept prompts with the cycle they were fetched in so the app flags them as outdated.
      return { ...college, entry: { ...prev, cycle: prev.cycle ?? previousFile.cycle ?? null }, kept: true };
    }
    const fresh = entry && { name: college.name, ...(college.scorecardId ? { scorecardId: college.scorecardId } : {}), ...entry };
    return { ...college, entry: fresh, kept: false, officialCount, collegeVineCount };
  });

  await renderer.close();

  const schools = { ...previous };
  const sources = { ...registry };
  for (const r of rows) {
    if (!r.entry) continue;
    schools[r.slug] = r.entry;
    if (r.entry.source === "official" && !r.kept) sources[r.slug] = { ...sources[r.slug], url: r.entry.url };
  }

  const report = buildReport({ cycle, rows, previous });
  if (args.report) await writeFile(args.report, report);
  console.log(`\n${report.split("\n").slice(0, 3).join("\n")}`);
  if (args["dry-run"]) return;

  const out = { cycle, generatedAt: new Date().toISOString().slice(0, 10), schools: sortedObject(schools) };
  await writeFile(PROMPTS, `${JSON.stringify(out, null, 2)}\n`);
  await writeFile(SOURCES, `${JSON.stringify(sortedObject(sources), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
