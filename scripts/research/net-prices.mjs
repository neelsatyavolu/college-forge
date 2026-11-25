// "latest" in the Scorecard API is its newest cost year, 2024-25 as of 2026-11 (update the label when it moves).
// Fills missing net-price-by-income facts in lib/school-research/*.json from the federal College
// Scorecard API (same data as NCES College Navigator). Plain fetch, no AI. Never overwrites a fact
// that is already there. Usage:
//   node --env-file=.env.local scripts/research/net-prices.mjs [--dry] [slug ...]
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.COLLEGE_SCORECARD_API_KEY;
if (!KEY) { console.error("COLLEGE_SCORECARD_API_KEY is not set."); process.exit(1); }
const ENDPOINT = "https://api.data.gov/ed/collegescorecard/v1/schools.json";
const DIR = path.resolve("lib/school-research");
const dry = process.argv.includes("--dry");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const today = new Date().toISOString().slice(0, 10);
const BRACKETS = [["0-30000", "net_price_lt30k"], ["30001-48000", "net_price_30_48k"], ["48001-75000", "net_price_48_75k"], ["75001-110000", "net_price_75_110k"], ["110001-plus", "net_price_gt110k"]];
const usNews = JSON.parse(fs.readFileSync("public/data/official-rankings.json", "utf8"));
const norm = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

async function scorecard(params) {
  const url = `${ENDPOINT}?${new URLSearchParams({ api_key: KEY, per_page: "5", ...params })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Scorecard ${res.status}`);
  return res.json();
}

const fields = ["id", "school.name", "school.school_url", "school.ownership", "latest.cost.tuition.in_state", ...BRACKETS.flatMap(([b]) => [`latest.cost.net_price.public.by_income_level.${b}`, `latest.cost.net_price.private.by_income_level.${b}`])].join(",");

async function findSchool(name, website) {
  const host = (website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const data = await scorecard({ "school.name": name, fields });
  const rows = data.results || [];
  const byHost = host && rows.find((r) => (r["school.school_url"] || "").includes(host));
  const exact = rows.find((r) => norm(r["school.name"]) === norm(name));
  return byHost || exact || (rows.length === 1 ? rows[0] : null);
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8")).schools;
let filled = 0, skipped = 0, missing = [];
for (const s of manifest) {
  if (only.length && !only.includes(s.slug)) continue;
  const file = path.join(DIR, `${s.slug}.json`);
  if (!fs.existsSync(file)) { missing.push(`${s.slug} (no file)`); continue; }
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const have = new Set(r.facts.map((f) => f.key));
  const need = BRACKETS.filter(([, key]) => !have.has(key));
  if (!need.length) { skipped++; continue; }
  let row;
  try { row = await findSchool(s.name, s.website); } catch (e) { missing.push(`${s.slug} (${e.message})`); continue; }
  if (!row) { missing.push(`${s.slug} (not found)`); continue; }
  const sector = row["school.ownership"] === 1 ? "public" : "private";
  const added = need.flatMap(([bracket, key]) => {
    const v = row[`latest.cost.net_price.${sector}.by_income_level.${bracket}`];
    if (typeof v !== "number") return [];
    const amount = v <= 0 ? "$0 (average grants exceeded the cost)" : `$${Math.round(v).toLocaleString("en-US")}`;
    return [{
      key, value: `${amount} average net price${sector === "public" ? " (in-state)" : ""}, federal aid recipients, 2024-25 (College Scorecard)`,
      sourceUrl: `https://collegescorecard.ed.gov/school/?${row.id}`, checkedAt: today, cycle: "2024-25", thirdParty: false,
    }];
  });
  if (!added.length) { missing.push(`${s.slug} (no net price published)`); continue; }
  const notesOut = r.facts.filter((f) => !(f.key === "notes" && /net price/i.test(f.value) && /(missing|not (available|captured|found)|timed out|blocked|couldn)/i.test(f.value)));
  const next = { ...r, facts: [...notesOut, ...added] };
  if (!dry) fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  filled++;
  console.log(`${dry ? "[dry] " : ""}${s.slug}: +${added.length} net price facts (${row["school.name"]}, ${sector})`);
}
console.log(`filled ${filled}, already complete ${skipped}, not filled ${missing.length}${missing.length ? ": " + missing.join("; ") : ""}`);
