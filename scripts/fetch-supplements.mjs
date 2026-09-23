#!/usr/bin/env node
/**
 * Refresh supplemental essay prompts for every U.S. News top-250 school by
 * scraping public web pages (no AI, no search APIs). Run yearly after
 * schools publish prompts (Aug–Sep); .github/workflows/refresh-supplements.yml
 * runs it on a schedule and opens a PR for review.
 *
 * For each school, in order:
 *   1. sources.json "noSupplements" → recorded as having none
 *   2. sources.json "url" (last known official prompt page) → extract
 *   3. crawl from sources.json "start" or the school's Common App-listed
 *      admissions site to find the official prompt page → extract
 *   4. CollegeVine's structured prompt page, matched by name via its
 *      sitemap (may lag a cycle; labeled). Its "does not require essays"
 *      notice for a past cycle records the school as having none.
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
import { collegeVineUrlFor, loadCollegeVineIndex, parseCollegeVine } from "./supplements/collegevine.mjs";

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

async function loadColleges() {
  const src = await readFile(RANKINGS, "utf8");
  const start = src.indexOf("= [", src.indexOf("US_NEWS_TOP_250: "));
  const end = src.indexOf("];", start);
  if (start < 0 || end < 0) throw new Error(`Could not find US_NEWS_TOP_250 array in ${RANKINGS}`);
  return JSON.parse(src.slice(start + 2, end + 1)).map(({ slug, name, rank }) => ({ slug, name, rank }));
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

async function fetchCollegeVine(college, { http, collegeVine, cycle }) {
  const cvUrl = collegeVineUrlFor(collegeVine, college.name, college.slug);
  const cv = await http.get(cvUrl);
  if (cv.status !== 200) return null;
  const parsed = parseCollegeVine(cv.text);
  const url = cv.url || cvUrl;
  if (parsed.prompts.length) return { source: "collegevine", url, cycle: parsed.cycle, prompts: parsed.prompts };
  // "Not available yet" can't apply to a cycle that has already ended.
  if (parsed.noEssays && parsed.cycle && parsed.cycle < cycle) {
    return { source: "none", url, cycle: parsed.cycle, note: `CollegeVine lists no essays (${parsed.cycle})` };
  }
  return null;
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
    return { ...college, entry: entry && { name: college.name, ...entry }, kept: false, officialCount, collegeVineCount };
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
