/**
 * Pure helpers for the Official rankings tab: parse the Forbes list, match one
 * school across the four lists, and shape public/data/official-rankings.json.
 */

export const FORBES_URL = (year) => `https://www.forbes.com/forbesapi/org/top-colleges/${year}/position/true.json?limit=500`;

// Names the lists spell differently that the normalizer can't line up.
const ALIASES = {
  "penn state": "pennsylvania state university",
  "pennsylvania state university university park": "pennsylvania state university",
  "virginia tech": "virginia polytechnic institute and state university",
  "william and mary": "college of william and mary",
  "new mexico tech": "new mexico institute of mining and technology",
  "university of minnesota twin cities": "university of minnesota",
  "rutgers university new brunswick": "rutgers university",
  "cooper union for advancement of science and art": "cooper union",
  "university of alabama birmingham": "university of alabama at birmingham",
  "georgia institute of technology": "georgia tech",
  "university of illinois urbana champaign": "university of illinois",
  "university of michigan ann arbor": "university of michigan",
  "university of texas austin": "university of texas",
  "university of maryland college park": "university of maryland",
  "university of wisconsin madison": "university of wisconsin",
  "university of washington seattle": "university of washington",
  "texas a and m university college station": "texas a and m university",
  "north carolina state university raleigh": "north carolina state university",
  "university buffalo suny": "university buffalo",
  "university of missouri columbia": "university of missouri",
  "tulane university of louisiana": "tulane university",
  "university of oklahoma norman": "university of oklahoma",
  "university of south": "sewanee",
  "sewanee university of south": "sewanee",
  "united states military academy west point": "united states military academy",
  "purdue university west lafayette": "purdue university",
  "cal poly": "california polytechnic state university san luis obispo",
  // The catalog's short names for California State University campuses.
  "cal poly pomona": "california state polytechnic university pomona",
  "cal state long beach": "california state university long beach",
  "chico state": "california state university chico",
  "fresno state": "california state university fresno",
  "csu san bernardino": "california state university san bernardino",
  "csu san marcos": "california state university san marcos",
  "miami university oxford": "miami university",
  "binghamton university suny": "binghamton university",
  "stony brook university suny": "stony brook university",
  "ohio state university columbus": "ohio state university",
  "university of pittsburgh pittsburgh": "university of pittsburgh",
  "cuny hunter college": "hunter college",
  "california polytechnic state univ san luis obispo": "california polytechnic state university san luis obispo",
};

/** One key per school, whatever list it came from. */
export function schoolKey(name) {
  let n = String(name || "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, " ") // "University of Miami (FL)"
    .replace(/&/g, " and ")
    .replace(/[‐-―–—-]/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // "San José"
    .replace(/[.,'’()]/g, "")
    .replace(/\b(the|at|in)\b/g, " ")
    .replace(/\b(main campus|campus)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  n = n.replace(/^georgia tech$/, "georgia institute of technology");
  return ALIASES[n] || n;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One Forbes list row, or null when it isn't a ranked school. */
export function parseForbes(o) {
  if (!o || !Number.isInteger(o.rank) || !o.organizationName) return null;
  return {
    rank: o.rank,
    name: String(o.organizationName),
    city: o.city ? String(o.city) : null,
    state: o.stateCode || o.state || null,
    facts: {
      admitRate: num(o.percentAdmitted),
      sat: typeof o.satCompositeRange === "string" ? o.satCompositeRange : null,
      cost: num(o.totalAnnualCost),
      salary: num(o.medianBaseSalary),
      undergrads: num(o.undergraduatePopulation),
      website: typeof o.webSite === "string" && /^(www\.)?[a-z0-9.-]+\.[a-z]{2,}$/i.test(o.webSite) ? o.webSite.toLowerCase() : null,
    },
  };
}

/**
 * Every school on the full lists, merged across lists by schoolKey, for the List tab
 * to look up schools outside the top-100 lists: [{name, usn, lac, forbes, niche}].
 * `usn` and `lac` are U.S. News's national and liberal arts ranks (a school has one).
 */
export function mergeSchools({ usnAll = [], lacAll = [], forbesAll = [], nicheAll = [] }) {
  const byKey = new Map();
  const add = (list, field) => {
    for (const s of list) {
      const k = schoolKey(s.name);
      const row = byKey.get(k) || { name: s.name };
      if (row[field] == null) row[field] = s.rank;
      byKey.set(k, row);
    }
  };
  add(usnAll, "usn");
  add(lacAll, "lac");
  add(forbesAll, "forbes");
  add(nicheAll, "niche");
  return [...byKey.values()];
}

/** "Atlanta, GA" on a Princeton Review row as city and state. */
function withPlace(s) {
  const m = /^(.*),\s*([A-Z]{2})$/.exec(s.place || "");
  return { rank: s.rank, name: s.name, city: m ? m[1] : null, state: m ? m[2] : null };
}

/**
 * Shapes the tab's data: each list keeps its own rank, name and place, plus
 * the facts we hold for that school (Forbes's full 500 list, then U.S. News)
 * and where it sits on the other three lists.
 */
const domainOf = (site) => (site ? String(site).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : null);

/**
 * A lookup from a ranked school to its catalog logo: by website domain first
 * (names differ across lists, domains don't), then by name or alias.
 */
export function logoFinder(catalog = []) {
  const byDomain = new Map();
  const byName = new Map();
  for (const c of catalog) {
    if (!c.logo) continue;
    for (const site of c.domains || []) {
      const d = domainOf(site);
      if (d && !byDomain.has(d)) byDomain.set(d, c.logo);
    }
    for (const n of [c.name, ...(c.aliases || [])]) {
      // The catalog says "UC Merced"; the lists say "University of California, Merced".
      for (const k of [schoolKey(n), schoolKey(n.replace(/^UC /i, "University of California "))]) {
        if (k && !byName.has(k)) byName.set(k, c.logo);
      }
    }
  }
  return (name, website) => byDomain.get(domainOf(website)) || byName.get(schoolKey(name)) || null;
}

/** Every list's id, in tab order. "forge" is the weighted average of the others (public/hub/rank-list.js). */
export const LIST_IDS = ["forge", "usn", "lac", "forbes", "niche", "wsj", "prPublic", "prPrivate"];

export function buildOfficial({ usn, lac, forbesAll, niche, editions, generated, catalog = [], extra, forge }) {
  const logoOf = logoFinder(catalog);
  const forbesTop = forbesAll.filter((s) => s.rank <= 100);
  const lists = {
    usn: usn.filter((s) => s.rank <= 100),
    lac: lac.filter((s) => s.rank <= 50),
    forbes: forbesTop,
    niche: niche.filter((s) => s.rank <= 100),
  };
  if (extra) {
    lists.wsj = extra.wsj.filter((s) => s.rank <= 100);
    lists.prPublic = extra.prPublic.map(withPlace);
    lists.prPrivate = extra.prPrivate.map(withPlace);
  }
  if (forge) lists.forge = forge.filter((s) => s.rank <= 100);
  const rankIn = {};
  const deep = { usn, lac, forbes: forbesAll, niche, ...(extra ? { wsj: extra.wsj, prPublic: extra.prPublic, prPrivate: extra.prPrivate } : {}) };
  for (const [id, list] of Object.entries(deep)) {
    rankIn[id] = new Map();
    for (const s of list) if (!rankIn[id].has(schoolKey(s.name))) rankIn[id].set(schoolKey(s.name), s.rank);
  }
  const forbesFacts = new Map(forbesAll.map((s) => [schoolKey(s.name), s.facts]));
  // City and state for lists that don't give them (WSJ, the Forge ranking).
  const placeOf = new Map();
  for (const s of [...forbesAll, ...usn, ...lac, ...niche]) {
    const k = schoolKey(s.name);
    if (s.city && !placeOf.has(k)) placeOf.set(k, { city: String(s.city).trim(), state: s.state || null });
  }
  const usnFacts = new Map(usn.map((s) => [schoolKey(s.name), s]));

  const shaped = {};
  const unmatched = [];
  for (const [id, list] of Object.entries(lists)) {
    shaped[id] = list.map((s) => {
      const key = schoolKey(s.name);
      const f = forbesFacts.get(key) || null;
      const u = usnFacts.get(key) || null;
      if (!f && !u && id !== "forbes") unmatched.push(`${id}: ${s.name}`);
      const facts = {
        admitRate: u && u.admitRate != null ? Math.round(u.admitRate * 1000) / 10 : f ? f.admitRate : null,
        sat: u && u.sat25 && u.sat75 ? `${u.sat25}-${u.sat75}` : f ? f.sat : null,
        cost: f ? f.cost : null,
        salary: f ? f.salary : null,
        undergrads: f ? f.undergrads : null,
        setting: u && u.settingDetail ? u.settingDetail : null,
        website: f ? f.website : null,
      };
      const elsewhere = {};
      for (const other of Object.keys(deep)) {
        if (other === id) continue;
        const r = rankIn[other].get(key);
        if (r != null) elsewhere[other] = r;
      }
      const at = placeOf.get(key) || {};
      const row = { rank: s.rank, name: s.name, city: (s.city && String(s.city).trim()) || at.city || null, state: s.state || at.state || null, logo: logoOf(s.name, facts.website), facts, elsewhere };
      if (id === "forge") row.avg = s.avg;
      if (id === "niche") { row.stars = s.stars ?? null; row.reviews = s.reviews ?? null; }
      return row;
    });
  }
  // Lists only the List tab's average reads, kept to rank and name.
  const data = { generated, editions, lists: shaped };
  if (extra) {
    data.extra = Object.fromEntries(["wsj", "prPublic", "prPrivate"].filter((id) => extra[id]).map((id) => [id, extra[id].map(({ rank, name }) => ({ rank, name }))]));
    if (extra.schools) data.extra.schools = extra.schools;
  }
  return { data, unmatched };
}
