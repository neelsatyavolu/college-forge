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

test("the data file has every list, the Forge ranking and the merged full lists", async () => {
  const data = JSON.parse(await readFile(path.join(__dirname, "../public/data/official-rankings.json"), "utf8"));
  assert.equal(data.lists.wsj.length, 100);
  assert.equal(data.lists.prPublic.length, 50);
  assert.equal(data.lists.prPrivate.length, 50);
  assert.equal(data.lists.forge.length, 100);
  assert.ok(data.lists.forge.every((r, i, a) => r.avg != null && (!i || r.avg >= a[i - 1].avg)));
  // Every school on every list has a logo.
  for (const [id, list] of Object.entries(data.lists)) assert.deepEqual(list.filter((r) => !r.logo).map((r) => r.name), [], id);
  // The merged table reaches well past the top-100 lists.
  assert.ok(data.extra.schools.length > 600);
  assert.ok(data.extra.schools.some((s) => s.usn > 300));
});

test("merged full lists join one school's ranks across publishers", async () => {
  const { mergeSchools } = await load();
  const rows = mergeSchools({
    usnAll: [{ rank: 10, name: "Alpha University" }],
    lacAll: [{ rank: 3, name: "Beta College" }],
    forbesAll: [{ rank: 20, name: "Alpha University" }],
    nicheAll: [{ rank: 30, name: "The Alpha University" }, { rank: 40, name: "Gamma State" }],
  });
  assert.deepEqual(rows.find((r) => r.name === "Alpha University"), { name: "Alpha University", usn: 10, forbes: 20, niche: 30 });
  assert.deepEqual(rows.find((r) => r.name === "Beta College"), { name: "Beta College", lac: 3 });
  assert.equal(rows.length, 3);
});

test("WSJ and Princeton Review pages parse to clean names", async () => {
  const { parsePrincetonReview, parseWsjTable, cleanName } = await import(pathToFileURL(path.join(__dirname, "../scripts/rankings/extra.mjs")).href);
  const pr = '<div class="ranked-box"><span>#7</span></div><h2><a href="/college/x">Harvard College</a></h2><li><span class="black-text">Cambridge, MA</span></li>'
    + '<div class="ranked-box"><span>#8</span></div><h2><a href="/college/y">St. Mary&#39;s College of Maryland</a></h2>';
  assert.deepEqual(parsePrincetonReview(pr), [
    { rank: 7, name: "Harvard University", place: "Cambridge, MA" },
    { rank: 8, name: "St. Mary’s College of Maryland", place: null },
  ]);
  const wsj = "<table><tr><td>Wall Street Journal/College Pulse Top 100</td></tr><tr><td>1</td><td>Stanford University</td><td>93</td></tr>"
    + "<tr><td>33</td><td>Texas A &amp; M University, College Station</td><td>80</td></tr></table>";
  assert.deepEqual(parseWsjTable(wsj), [{ rank: 1, name: "Stanford University" }, { rank: 33, name: "Texas A&M University, College Station" }]);
  assert.equal(cleanName("Brigham Young University (UT)"), "Brigham Young University");
  assert.equal(cleanName("State University of New York - Binghamton University"), "Binghamton University");
  assert.equal(cleanName("California Polytechnic State Univ., San Luis Obispo"), "California Polytechnic State University, San Luis Obispo");
});
