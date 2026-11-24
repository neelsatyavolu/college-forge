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
};

/** One key per school, whatever list it came from. */
export function schoolKey(name) {
  let n = String(name || "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, " ") // "University of Miami (FL)"
    .replace(/&/g, " and ")
    .replace(/[‐-―–—-]/g, " ")
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
 * Shapes the tab's data: each list keeps its own rank, name and place, plus
 * the facts we hold for that school (Forbes's full 500 list, then U.S. News)
 * and where it sits on the other three lists.
 */
export function buildOfficial({ usn, lac, forbesAll, niche, editions, generated }) {
  const forbesTop = forbesAll.filter((s) => s.rank <= 100);
  const lists = {
    usn: usn.filter((s) => s.rank <= 100),
    lac: lac.filter((s) => s.rank <= 50),
    forbes: forbesTop,
    niche: niche.filter((s) => s.rank <= 100),
  };
  const rankIn = {};
  for (const [id, list] of Object.entries({ usn, lac, forbes: forbesAll, niche })) {
    rankIn[id] = new Map();
    for (const s of list) if (!rankIn[id].has(schoolKey(s.name))) rankIn[id].set(schoolKey(s.name), s.rank);
  }
  const forbesFacts = new Map(forbesAll.map((s) => [schoolKey(s.name), s.facts]));
  const usnFacts = new Map(usn.map((s) => [schoolKey(s.name), s]));

  const shaped = {};
  const unmatched = [];
  for (const [id, list] of Object.entries(lists)) {
    shaped[id] = list.map((s) => {
      const key = schoolKey(s.name);
      const f = forbesFacts.get(key) || null;
      const u = usnFacts.get(key) || null;
      if (!f && id !== "forbes") unmatched.push(`${id}: ${s.name}`);
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
      for (const other of ["usn", "lac", "forbes", "niche"]) {
        if (other === id) continue;
        const r = rankIn[other].get(key);
        if (r != null) elsewhere[other] = r;
      }
      const row = { rank: s.rank, name: s.name, city: s.city || null, state: s.state || null, facts, elsewhere };
      if (id === "niche") { row.stars = s.stars ?? null; row.reviews = s.reviews ?? null; }
      return row;
    });
  }
  return { data: { generated, editions, lists: shaped }, unmatched };
}
