#!/usr/bin/env node
/**
 * Builds public/data/official-rankings.json for the hub's Official rankings tab:
 * U.S. News top 100 national universities and top 50 liberal arts colleges
 * (from lib/us-news-rankings.ts, refreshed by fetch-usnews-rankings.mjs),
 * Forbes's top 100 (its public list JSON) and Niche's top 100 (saved in
 * scripts/rankings/niche-best-colleges.json, since Niche blocks plain clients).
 *
 *   node scripts/fetch-official-rankings.mjs [--forbes-year 2027] [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFetcher } from "./supplements/http.mjs";
import { FORBES_URL, parseForbes, buildOfficial } from "./rankings/official.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const RANKINGS = root("lib/us-news-rankings.ts");
const NICHE = root("scripts/rankings/niche-best-colleges.json");
const OUT = root("public/data/official-rankings.json");

async function usNewsArray(name) {
  const src = await readFile(RANKINGS, "utf8");
  const at = src.indexOf(`${name}: `);
  const start = src.indexOf("= [", at);
  const end = src.indexOf("\n];", start);
  if (at < 0 || start < 0 || end < 0) throw new Error(`Could not find ${name} in ${RANKINGS}`);
  return JSON.parse(src.slice(start + 2, end + 2));
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

  const usnSrc = await readFile(RANKINGS, "utf8");
  const usnEdition = (usnSrc.match(/US_NEWS_EDITION = "(\d{4})"/) || [])[1] || "";
  const niche = JSON.parse(await readFile(NICHE, "utf8"));
  const { data, unmatched } = buildOfficial({
    usn: await usNewsArray("US_NEWS_TOP_250"),
    lac: await usNewsArray("US_NEWS_LAC_TOP_N"),
    forbesAll,
    niche: niche.schools,
    editions: { usn: `${usnEdition} edition`, forbes: `${forbesYear} list`, niche: niche.edition },
    generated: new Date().toISOString().slice(0, 10),
  });
  for (const [id, list] of Object.entries(data.lists)) console.log(`${id}: ${list.length} schools`);
  if (unmatched.length) console.log(`No Forbes facts for ${unmatched.length}:\n  ${unmatched.join("\n  ")}`);
  if (argv.includes("--dry-run")) return;
  await writeFile(OUT, JSON.stringify(data) + "\n");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
