const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const load = () => import(pathToFileURL(path.join(__dirname, "../scripts/rankings/official.mjs")).href);

test("one school's names on the four lists share a key", async () => {
  const { schoolKey } = await load();
  const same = [
    ["University of Michigan--Ann Arbor", "University of Michigan - Ann Arbor", "University of Michigan, Ann Arbor"],
    ["University of California, Berkeley", "University of California - Berkeley", "University of California Berkeley"],
    ["Pennsylvania State University--University Park", "Penn State", "Pennsylvania State University-Main Campus"],
    ["Texas A&M University", "Texas A&M University, College Station"],
    ["University of Miami", "University of Miami (FL)"],
    ["William & Mary", "College of William & Mary"],
    ["University at Buffalo--SUNY", "University at Buffalo"],
  ];
  for (const names of same) assert.equal(new Set(names.map(schoolKey)).size, 1, names.join(" / "));
  assert.notEqual(schoolKey("Miami University (OH)"), schoolKey("University of Miami (FL)"));
  assert.notEqual(schoolKey("Trinity College (CT)"), schoolKey("Trinity University (TX)"));
});

test("a Forbes row keeps its rank, place and facts; junk is dropped", async () => {
  const { parseForbes } = await load();
  const row = parseForbes({ rank: 2, organizationName: "Princeton University", city: "Princeton", stateCode: "NJ", percentAdmitted: 5, satCompositeRange: "1510-1580", totalAnnualCost: 87888, medianBaseSalary: 121773, undergraduatePopulation: 5813, webSite: "www.princeton.edu" });
  assert.deepEqual(row, { rank: 2, name: "Princeton University", city: "Princeton", state: "NJ", facts: { admitRate: 5, sat: "1510-1580", cost: 87888, salary: 121773, undergrads: 5813, website: "www.princeton.edu" } });
  assert.equal(parseForbes({ rank: 3, organizationName: "X", webSite: "javascript:alert(1)" }).facts.website, null);
  assert.equal(parseForbes({ organizationName: "No rank" }), null);
});

test("lists are cut to their top N and cross-reference each other", async () => {
  const { buildOfficial } = await load();
  const forbesAll = [1, 2, 150].map((rank, i) => ({ rank, name: ["Alpha University", "Beta College", "Gamma University"][i], city: null, state: null, facts: { admitRate: 10, sat: null, cost: 1, salary: 2, undergrads: 3, website: null } }));
  const { data } = buildOfficial({
    usn: [{ rank: 1, name: "Alpha University", admitRate: 0.051, sat25: 1500, sat75: 1580 }, { rank: 101, name: "Gamma University" }],
    lac: [{ rank: 4, name: "Beta College" }, { rank: 51, name: "Delta College" }],
    forbesAll,
    niche: [{ rank: 7, name: "Alpha University", stars: 4.1, reviews: 10 }],
    editions: {},
    generated: "2026-11-24",
  });
  assert.deepEqual(data.lists.usn.map((r) => r.name), ["Alpha University"]);
  assert.deepEqual(data.lists.lac.map((r) => r.name), ["Beta College"]);
  assert.deepEqual(data.lists.forbes.map((r) => r.rank), [1, 2]);
  const alpha = data.lists.usn[0];
  assert.deepEqual(alpha.elsewhere, { forbes: 1, niche: 7 });
  assert.equal(alpha.facts.admitRate, 5.1); // U.S. News/Scorecard first
  assert.equal(alpha.facts.sat, "1500-1580");
  assert.equal(data.lists.niche[0].stars, 4.1);
  assert.deepEqual(data.lists.lac[0].elsewhere, { forbes: 2 });
});

test("a ranked school finds its catalog logo by domain, then by name", async () => {
  const { logoFinder } = await load();
  const logoOf = logoFinder([
    { name: "Amherst College", aliases: [], domains: ["amherst.edu"], logo: "/logos/amherst.png" },
    { name: "UC Merced", aliases: [], domains: ["ucmerced.edu"], logo: "/logos/ucmerced.png" },
    { name: "Testing College", aliases: [], domains: ["testing.edu"], logo: null },
  ]);
  assert.equal(logoOf("Some Other Name", "www.amherst.edu"), "/logos/amherst.png");
  assert.equal(logoOf("University of California, Merced", null), "/logos/ucmerced.png");
  assert.equal(logoOf("Testing College", "testing.edu"), null);
  assert.equal(logoOf("Unknown University", null), null);
});

test("the saved data file has the four lists at their sizes", async () => {
  const data = JSON.parse(await readFile(path.join(__dirname, "../public/data/official-rankings.json"), "utf8"));
  assert.ok(data.lists.usn.length >= 100 && data.lists.usn.every((r) => r.rank <= 100));
  assert.ok(data.lists.lac.length >= 50 && data.lists.lac.every((r) => r.rank <= 50));
  assert.equal(data.lists.forbes.length, 100);
  assert.equal(data.lists.niche.length, 100);
});
