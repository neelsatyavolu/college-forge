#!/usr/bin/env node
/**
 * Builds public/data/official-rankings.json for the hub's Official rankings tab:
 * U.S. News top 100 national universities and top 50 liberal arts colleges
 * (from lib/us-news-rankings.ts, refreshed by fetch-usnews-rankings.mjs),
 * Forbes's top 100 (its public list JSON) and Niche's top 100 (saved in
 * scripts/rankings/niche-best-colleges.json, since Niche blocks plain clients).
 * Also the two lists only the List tab's average uses (under "extra"): the WSJ/College
 * Pulse top 100 (saved in scripts/rankings/wsj-best-colleges.json; --wsj-url re-reads it
 * from a Poets&Quants article) and the Princeton Review's Top 50 Best Value Colleges.
 *
 *   node scripts/fetch-official-rankings.mjs [--forbes-year 2027] [--wsj-url <url>] [--dry-run]
 */
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { createFetcher } from "./supplements/http.mjs";
import { FORBES_URL, parseForbes, buildOfficial, mergeSchools } from "./rankings/official.mjs";
import { PRINCETON_REVIEW_URL, parsePrincetonReview, parseWsjTable, checkList } from "./rankings/extra.mjs";
import { NATIONAL, LIBERAL_ARTS, searchPageUrl, parseItem } from "./rankings/usnews.mjs";

// usnews.com's CDN stalls requests without a browser user agent.
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** A whole U.S. News list, rank and name only, from the public search API behind usnews.com/best-colleges. */
async function usNewsAll(schoolType) {
  const http = createFetcher({ userAgent: BROWSER_UA, perHostDelayMs: 1500 });
  const out = [];
  for (let page = 1; page <= 80; page++) {
    const res = await http.get(searchPageUrl(page, schoolType));
    if (res.status !== 200) throw new Error(`U.S. News ${schoolType} page ${page}: ${res.error || `HTTP ${res.status}`}`);
    const data = JSON.parse(res.text).data;
    for (const r of (data?.items || []).map(parseItem).filter(Boolean)) out.push({ rank: r.rank, name: r.name });
    if (!data?.hasNextPage) break;
  }
  return out;
}

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const RANKINGS = root("lib/us-news-rankings.ts");
const NICHE = root("scripts/rankings/niche-best-colleges.json");
const WSJ = root("scripts/rankings/wsj-best-colleges.json");
const OUT = root("public/data/official-rankings.json");

async function usNewsArray(name) {
  const src = await readFile(RANKINGS, "utf8");
  const at = src.indexOf(`${name}: `);
  const start = src.indexOf("= [", at);
  const end = src.indexOf("\n];", start);
  if (at < 0 || start < 0 || end < 0) throw new Error(`Could not find ${name} in ${RANKINGS}`);
  return JSON.parse(src.slice(start + 2, end + 2));
}

/** The college catalog (lib/catalog, TypeScript) with each school's logo path. */
async function catalogLogos() {
  const dir = await mkdtemp(join(tmpdir(), "forge-catalog-"));
  try {
    const out = join(dir, "catalog.mjs");
    await build({ entryPoints: [root("lib/catalog/index.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
    const { COLLEGES, logoUrl } = await import(pathToFileURL(out).href);
    // A logo file named for the school's id counts too, mapped in lib/catalog or not.
    const logoOf = (id) => logoUrl(id) || (existsSync(root(`public/logos/${id}.png`)) ? `/logos/${id}.png` : null);
    const extra = JSON.parse(await readFile(root("scripts/rankings/extra-logos.json"), "utf8")).schools;
    return [
      ...COLLEGES.map((c) => ({ name: c.name, aliases: c.aliases || [], domains: [c.website, ...(c.domains || [])].filter(Boolean), logo: logoOf(c.id) })),
      ...extra.map((e) => ({ name: e.name, aliases: e.aliases || [], domains: e.domains || [], logo: e.logo })),
    ];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const yi = argv.indexOf("--forbes-year");
  const forbesYear = yi >= 0 ? Number(argv[yi + 1]) : new Date().getFullYear() + 1;
  if (!Number.isInteger(forbesYear) || forbesYear < 2020) throw new Error("--forbes-year must be a year");

  const http = createFetcher();
  const res = await http.get(FORBES_URL(forbesYear));
  if (res.status !== 200) throw new Error(`Forbes ${forbesYear}: ${res.error || `HTTP ${res.status}`}`);
  const forbesAll = (JSON.parse(res.text).organizationList?.organizationsLists || []).map(parseForbes).filter(Boolean);
  if (forbesAll.length < 100) throw new Error(`Forbes ${forbesYear}: only ${forbesAll.length} schools`);

  // Princeton Review: two pages of 25 per list; the landing page names the edition year.
  const pr = {};
  for (const kind of ["public", "private"]) {
    let list = [];
    for (const page of [1, 2]) {
      const r = await http.get(PRINCETON_REVIEW_URL(kind, page));
      if (r.status !== 200) throw new Error(`Princeton Review ${kind} page ${page}: ${r.error || `HTTP ${r.status}`}`);
      list = list.concat(parsePrincetonReview(r.text));
    }
    pr[kind] = checkList(list, 50, `Princeton Review ${kind}`);
  }
  const landing = await http.get("https://www.princetonreview.com/college-rankings/best-value-colleges");
  const prYear = (String(landing.text || "").match(/Ranking Lists for (\d{4})/) || [])[1] || "";

  // WSJ: the saved capture, or re-read from a Poets&Quants article when --wsj-url is given.
  const wi = argv.indexOf("--wsj-url");
  let wsjFile = JSON.parse(await readFile(WSJ, "utf8"));
  if (wi >= 0) {
    const url = argv[wi + 1];
    if (!/^https:\/\/poetsandquants(forundergrads)?\.com\//.test(url || "")) throw new Error("--wsj-url must be a Poets&Quants article");
    const r = await http.get(url);
    if (r.status !== 200) throw new Error(`WSJ table: ${r.error || `HTTP ${r.status}`}`);
    const schools = checkList(parseWsjTable(r.text), 100, "WSJ top 100");
    wsjFile = { ...wsjFile, source: url, captured: new Date().toISOString().slice(0, 10), schools };
    console.log("Update the edition in scripts/rankings/wsj-best-colleges.json if WSJ published a new one.");
    if (!argv.includes("--dry-run")) await writeFile(WSJ, JSON.stringify(wsjFile, null, 1) + "\n");
  }

  const usnSrc = await readFile(RANKINGS, "utf8");
  const usnEdition = (usnSrc.match(/US_NEWS_EDITION = "(\d{4})"/) || [])[1] || "";
  const niche = JSON.parse(await readFile(NICHE, "utf8"));
  const usnAll = await usNewsAll(NATIONAL);
  const lacAll = await usNewsAll(LIBERAL_ARTS);
  console.log(`U.S. News full lists: ${usnAll.length} national, ${lacAll.length} liberal arts`);
  const nicheAll = niche.schools;
  const schoolsAll = mergeSchools({ usnAll, lacAll, forbesAll, nicheAll });

  const input = {
    usn: await usNewsArray("US_NEWS_TOP_250"),
    lac: await usNewsArray("US_NEWS_LAC_TOP_N"),
    forbesAll,
    niche: niche.schools,
    editions: {
      usn: `${usnEdition} edition`, forbes: `${forbesYear} list`, niche: niche.edition,
      wsj: `${(String(wsjFile.edition).match(/\d{4}/) || [""])[0]} edition`.trim(), pr: prYear ? `${prYear} list` : "",
    },
    extra: { wsj: checkList(wsjFile.schools, 100, "WSJ top 100"), prPublic: pr.public, prPrivate: pr.private, schools: schoolsAll },
    generated: new Date().toISOString().slice(0, 10),
    catalog: await catalogLogos(),
  };
  // The Forge ranking is the List tab's weighted average over the lists just built.
  const { forgeRanking } = createRequire(import.meta.url)("../public/hub/rank-list.js");
  const forge = forgeRanking(buildOfficial(input).data);
  const { data, unmatched } = buildOfficial({ ...input, forge });
  for (const [id, list] of Object.entries(data.lists)) console.log(`${id}: ${list.length} schools`);
  const noLogo = Object.entries(data.lists).flatMap(([id, list]) => list.filter((s) => !s.logo).map((s) => `${id}: ${s.name}`));
  if (noLogo.length) console.log(`No logo for ${noLogo.length}:\n  ${noLogo.join("\n  ")}`);
  if (unmatched.length) console.log(`No Forbes facts for ${unmatched.length}:\n  ${unmatched.join("\n  ")}`);
  if (argv.includes("--dry-run")) return;
  await writeFile(OUT, JSON.stringify(data) + "\n");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
