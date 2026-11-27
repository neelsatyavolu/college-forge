#!/usr/bin/env node
/**
 * Build public/data/explore-colleges.json, the college list the Explore tab browses.
 *
 *   node --env-file=.env.local scripts/explore/build-catalog.mjs [--min-size 1000] [--dry-run]
 *
 * 1. College Scorecard: every operating public or nonprofit college that mainly awards bachelor's
 *    or graduate degrees and enrolls at least --min-size undergraduates, plus every school on the
 *    U.S. News lists in lib/us-news-rankings.ts whatever its size.
 * 2. Wikidata: each college's image (P18), matched by IPEDS id (P1771), with license and author
 *    from Wikimedia Commons. Only freely licensed, landscape photos 900px or wider are kept.
 * 3. Ranks and Forge's curated photos come from lib/us-news-rankings.ts.
 *
 * Plain HTTP to public, keyless (Wikidata, Commons) or free-key (Scorecard) APIs; run yearly.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  SCORECARD_FIELDS,
  articlePhotoCandidates,
  assignSlugs,
  commonsPhoto,
  commonsTitle,
  dropNulls,
  imageSize,
  pickPhoto,
  scorecardRow,
} from "./catalog.mjs";

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const OUT = root("public/data/explore-colleges.json");
const UA = "CollegeForgeCatalogBot/1.0 (+https://github.com/neelsatyavolu/college-forge; yearly college list refresh)";
const SCORECARD = "https://api.data.gov/ed/collegescorecard/v1/schools.json";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const MIN_SIZE = Number(opt("--min-size", 1000));
const DRY = args.includes("--dry-run");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, init = {}, tries = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers || {}) } });
    if (res.ok) return res.json();
    if (i >= tries - 1 || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`${new URL(url).host} ${res.status}`);
    }
    await sleep(1500 * (i + 1));
  }
}

async function loadArray(name) {
  const src = await readFile(root("lib/us-news-rankings.ts"), "utf8");
  const at = src.indexOf(`${name}: `);
  const start = src.indexOf("= [", at);
  const end = src.indexOf("\n];", start);
  if (at < 0 || start < 0 || end < 0) throw new Error(`no ${name} in lib/us-news-rankings.ts`);
  return JSON.parse(src.slice(start + 2, end + 2));
}

async function scorecardPages(key, filters) {
  const out = [];
  for (let page = 0; page < 60; page++) {
    const url = new URL(SCORECARD);
    url.searchParams.set("api_key", key);
    for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
    url.searchParams.set("fields", SCORECARD_FIELDS.join(","));
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const body = await getJson(url.toString());
    out.push(...(body.results || []));
    const total = body.metadata?.total ?? 0;
    if ((page + 1) * 100 >= total) break;
    await sleep(250);
  }
  return out;
}

async function fetchScorecard(key, ids) {
  const base = await scorecardPages(key, {
    "school.operating": "1",
    "school.degrees_awarded.predominant__range": "3..4",
    "school.ownership__range": "1..2",
    "latest.student.size__range": `${MIN_SIZE}..`,
  });
  const have = new Set(base.map((r) => r.id));
  const missing = ids.filter((id) => !have.has(id));
  const extra = [];
  for (let i = 0; i < missing.length; i += 50) {
    extra.push(...(await scorecardPages(key, { id: missing.slice(i, i + 50).join(",") })));
  }
  return [...base, ...extra];
}

/** Wikidata image properties, best first: image, aerial view, night view. */
const IMAGE_PROPS = ["P18", "P8592", "P3451"];

async function fetchWikidataImages() {
  const opt = IMAGE_PROPS.map((p, i) => `OPTIONAL { ?u wdt:${p} ?i${i} . }`).join(" ");
  const wiki = "OPTIONAL { ?article schema:about ?u ; schema:isPartOf <https://en.wikipedia.org/> . }";
  const q = `SELECT ?ipeds ?article ${IMAGE_PROPS.map((_, i) => `?i${i}`).join(" ")} WHERE { ?u wdt:P1771 ?ipeds . ${opt} ${wiki} }`;
  const body = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  const byId = new Map();
  const articles = new Map();
  for (const b of body.results.bindings) {
    const id = Number(b.ipeds.value);
    if (b.article?.value && !articles.has(id)) articles.set(id, decodeURIComponent(b.article.value.replace(/^https:\/\/en\.wikipedia\.org\/wiki\//, "")).replace(/_/g, " "));
    const list = byId.get(id) || [];
    for (let i = 0; i < IMAGE_PROPS.length; i++) {
      const v = b[`i${i}`]?.value;
      if (v && !list.includes(v)) list.push(v);
    }
    if (list.length) byId.set(id, list);
  }
  return { byId, articles };
}

/** Image file names in an English Wikipedia article, in the order they appear. */
async function fetchArticleImages(title) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "parse");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "images");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("page", title);
  const body = await getJson(url.toString()).catch(() => null);
  return body?.parse?.images || [];
}

async function fetchCommonsInfo(titles) {
  const info = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url|size|extmetadata");
    url.searchParams.set("iiurlwidth", "1280");
    url.searchParams.set("iiextmetadatafilter", "Artist|LicenseShortName|DateTimeOriginal");
    url.searchParams.set("titles", titles.slice(i, i + 40).join("|"));
    const body = await getJson(url.toString());
    const norm = new Map((body.query?.normalized || []).map((n) => [n.to, n.from]));
    for (const p of Object.values(body.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      info.set(norm.get(p.title) || p.title, { ...ii, page: ii.descriptionurl });
    }
    await sleep(200);
  }
  return info;
}

async function main() {
  const key = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!key) throw new Error("COLLEGE_SCORECARD_API_KEY is required (node --env-file=.env.local …)");

  const national = await loadArray("US_NEWS_TOP_250");
  const lac = await loadArray("US_NEWS_LAC_TOP_N");
  const nat = new Map(national.map((u) => [u.scorecardId, u]));
  const lib = new Map(lac.map((u) => [u.scorecardId, u]));

  const raw = await fetchScorecard(key, [...nat.keys(), ...lib.keys()]);
  const { byId: images, articles } = await fetchWikidataImages();
  const titles = [...new Set(raw.flatMap((r) => images.get(r.id) || []).map(commonsTitle).filter(Boolean))];
  const commons = await fetchCommonsInfo(titles);
  const passes = (id) => (images.get(id) || []).some((u) => {
    const info = commons.get(commonsTitle(u));
    return info && commonsPhoto(info, info.page);
  });

  // No usable Wikidata photo: try the campus photos in the college's Wikipedia article.
  const fromArticle = new Map();
  const needArticle = raw.filter((r) => !passes(r.id) && articles.has(r.id));
  for (const r of needArticle) {
    fromArticle.set(r.id, articlePhotoCandidates(await fetchArticleImages(articles.get(r.id))));
    await sleep(120);
  }
  const extraTitles = [...new Set([...fromArticle.values()].flat())].filter((t) => !commons.has(t));
  for (const [k, v] of await fetchCommonsInfo(extraTitles)) commons.set(k, v);
  console.log(`${needArticle.length} colleges checked in Wikipedia articles · ${extraTitles.length} more files`);
  console.log(`${raw.length} Scorecard rows · ${titles.length} Wikidata images (${IMAGE_PROPS.join(", ")}) · ${commons.size} with Commons info`);

  const localSizes = new Map();
  for (const u of national) {
    if (!u.photo?.startsWith("/")) continue;
    const buf = await readFile(root(`public${u.photo}`)).catch(() => null);
    if (buf) localSizes.set(u.photo, imageSize(buf));
  }

  const rows = raw
    .map((r) => {
      const base = scorecardRow(r);
      if (!base.id || !base.name) return null;
      const n = nat.get(base.id);
      const l = lib.get(base.id);
      // The first candidate that passes the size and license bar.
      const pick = [...(images.get(base.id) || []).map(commonsTitle), ...(fromArticle.get(base.id) || [])]
        .map((t) => commons.get(t))
        .map((info) => (info ? commonsPhoto(info, info.page) : null))
        .find(Boolean) || null;
      const localSize = n?.photo?.startsWith("/") ? localSizes.get(n.photo) : null;
      const photo = pickPhoto({ usnewsPhoto: n?.photo ?? null, localSize, commons: pick });
      return dropNulls({
        ...base,
        slug: n?.slug || l?.slug || null,
        name: n?.name || l?.name || base.name,
        rank: n?.rank ?? null,
        lacRank: l?.rank ?? null,
        gpa: n?.gpa ?? null,
        ...photo,
      });
    })
    .filter(Boolean)
    // Ranked schools first so they keep their U.S. News slugs; then by enrollment.
    .sort((a, b) => (a.rank ?? a.lacRank ?? 9999) - (b.rank ?? b.lacRank ?? 9999) || (b.size ?? 0) - (a.size ?? 0));

  const colleges = assignSlugs(rows);
  const withCommons = colleges.filter((c) => c.credit).length;
  const withAny = colleges.filter((c) => c.photo).length;
  console.log(`${colleges.length} colleges · ${withAny} with a photo (${withCommons} from Wikimedia Commons)`);

  if (DRY) return;
  const out = {
    source: "U.S. Dept. of Education College Scorecard; ranks from U.S. News (lib/us-news-rankings.ts); photos from Wikimedia Commons via Wikidata",
    generatedAt: new Date().toISOString().slice(0, 10),
    minSize: MIN_SIZE,
    colleges,
  };
  await writeFile(OUT, `${JSON.stringify(out)}\n`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
