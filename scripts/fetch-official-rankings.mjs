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
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { existsSync } from "node:fs";
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

/** The college catalog (lib/catalog, TypeScript) with each school's logo path. */
async function catalogLogos() {
  const dir = await mkdtemp(join(tmpdir(), "forge-catalog-"));
  try {
    const out = join(dir, "catalog.mjs");
    await build({ entryPoints: [root("lib/catalog/index.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
    const { COLLEGES, logoUrl } = await import(pathToFileURL(out).href);
    // A logo file named for the school's id counts too, mapped in lib/catalog or not.
    const logoOf = (id) => logoUrl(id) || (existsSync(root(`public/logos/${id}.png`)) ? `/logos/${id}.png` : null);
    return COLLEGES.map((c) => ({ name: c.name, aliases: c.aliases || [], domains: [c.website, ...(c.domains || [])].filter(Boolean), logo: logoOf(c.id) }));
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
    catalog: await catalogLogos(),
  });
  for (const [id, list] of Object.entries(data.lists)) console.log(`${id}: ${list.length} schools`);
  const noLogo = Object.entries(data.lists).flatMap(([id, list]) => list.filter((s) => !s.logo).map((s) => `${id}: ${s.name}`));
  if (noLogo.length) console.log(`No logo for ${noLogo.length}:\n  ${noLogo.join("\n  ")}`);
  if (unmatched.length) console.log(`No Forbes facts for ${unmatched.length}:\n  ${unmatched.join("\n  ")}`);
  if (argv.includes("--dry-run")) return;
  await writeFile(OUT, JSON.stringify(data) + "\n");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
