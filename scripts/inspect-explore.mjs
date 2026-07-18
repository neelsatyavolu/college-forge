// Verifies Explore is a real college search: Scorecard-backed results,
// alias expansion, setting filters, and add/remove round-trip.
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3210";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let fail = 0;
const ok = (c, label) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fail = 1; };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 950 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(`${BASE}/hub/index.html`, { waitUntil: "networkidle2" });

const api = (path) => page.evaluate(async (p) => {
  const r = await fetch(p, { credentials: "same-origin" });
  return { status: r.status, body: await r.json() };
}, path);

console.log("=== search API (College Scorecard) ===");
const stanford = await api("/api/colleges/search?q=stanford");
ok(stanford.status === 200 && stanford.body.success, `search "stanford" -> ${stanford.status}`);
const top = stanford.body.data?.[0];
console.log(`      top hit: ${top?.name} | admit=${top?.admit} SAT=${top?.satRange} net=${top?.netPrice} grad=${top?.grad6} earn=${top?.earnings} setting=${top?.setting}`);
ok(/stanford/i.test(top?.name || ""), "top result is Stanford");
ok(!!top?.admit && !!top?.satRange && !!top?.netPrice, "real Scorecard data present (admit/SAT/net price)");

// Alias expansion: "MIT" must resolve to the full name.
const mit = await api("/api/colleges/search?q=MIT");
const mitTop = mit.body.data?.[0];
console.log(`      "MIT" -> ${mitTop?.name}`);
ok(/massachusetts institute of technology/i.test(mitTop?.name || ""), "alias 'MIT' expands to MIT's full name");

// Breadth: a generic term should return many distinct schools.
const uni = await api("/api/colleges/search?q=university%20of%20california");
console.log(`      "university of california" -> ${uni.body.data?.length} results`);
ok((uni.body.data?.length || 0) >= 5, "generic query returns many schools (real DB, not a fixed list)");

// Settings come through for the filter chips.
const settings = new Set((uni.body.data || []).map((c) => c.setting).filter(Boolean));
console.log(`      settings seen: ${[...settings].join(", ") || "(none)"}`);
ok(settings.size >= 1, "campus setting derived from Scorecard locale");

console.log("\n=== per-school detail (parity with reference panel) ===");
const det = await api(`/api/colleges/detail?id=${top.scorecardId}`);
ok(det.status === 200 && det.body.success, `detail id=${top.scorecardId} -> ${det.status}`);
const D = det.body.data || {};
const shown = (k) => D[k] !== undefined && D[k] !== null && D[k] !== "";
for (const f of ["netPrice", "coa", "tuitionIn", "tuitionOut", "grad4", "grad6", "retention", "earnings", "admit", "satRange", "act", "size", "ownership", "testPolicy", "url", "priceCalcUrl"]) {
  console.log(`      ${f.padEnd(13)} = ${D[f] ?? "(missing)"}`);
}
ok(["netPrice", "coa", "tuitionIn", "tuitionOut", "grad4", "grad6", "retention", "earnings"].every(shown),
  "all Cost & outcomes fields wired (net price, COA, tuition in/out, grad 4/6, retention, earnings)");
ok(shown("ownership") && shown("testPolicy"), "ownership + test policy wired");
ok(shown("url") && shown("priceCalcUrl"), "website + net price calculator links wired");

const progs = D.programs || [];
console.log(`      programs: ${progs.length} bachelor's`);
console.log(`      sample: ${progs.slice(0, 3).map((p) => `${p.title} [${p.area}]`).join(" | ")}`);
ok(progs.length >= 10, "Schools & programs populated");
ok(progs.every((p) => p.credential === "Bachelor's"), "programs filtered to bachelor's level");
ok(new Set(progs.map((p) => p.area)).size >= 5, "programs grouped across multiple CIP areas");

const withEarnings = progs.filter((p) => typeof p.earnings4 === "number");
const withNational = progs.filter((p) => typeof p.national4 === "number");
const cs = progs.find((p) => /computer science/i.test(p.title));
if (cs) console.log(`      CS: $${cs.earnings4?.toLocaleString()} vs national $${cs.national4?.toLocaleString()}`);
ok(withEarnings.length >= 5, `field-of-study earnings present (${withEarnings.length} programs)`);
ok(withNational.length >= 5, `national earnings baseline present (${withNational.length} programs)`);

console.log("\n=== add / remove round-trip ===");
const before = (await api("/api/workspace")).body.colleges.length;
const added = await page.evaluate(async (college) => {
  const r = await fetch("/api/workspace/colleges", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ college }),
  });
  return { status: r.status, body: await r.json() };
}, top);
ok(added.status === 200 && added.body.success, "POST /api/workspace/colleges adds the school");
const afterAdd = (await api("/api/workspace")).body.colleges;
console.log(`      workspace colleges: ${before} -> ${afterAdd.length} (${afterAdd.map((c) => c.short).join(", ")})`);
ok(afterAdd.length === before + 1, "school persisted to the workspace");
ok(!!afterAdd[0]?.admit && !!afterAdd[0]?.netPrice, "persisted school kept its real data");

const removed = await page.evaluate(async (slug) => {
  const r = await fetch(`/api/workspace/colleges?slug=${encodeURIComponent(slug)}`, { method: "DELETE", credentials: "same-origin" });
  return { status: r.status, body: await r.json() };
}, top.slug);
ok(removed.status === 200 && removed.body.success, "DELETE removes the school");
ok((await api("/api/workspace")).body.colleges.length === before, "workspace back to original count");

console.log("\n=== UI: type into the search box ===");
// Navigate to the Explore tab first.
for (const l of await page.$$("nav a")) {
  if ((await l.evaluate((n) => n.textContent.trim())) === "Explore") { await l.click(); break; }
}
await new Promise((r) => setTimeout(r, 600));

const box = await page.evaluateHandle(() => {
  const inputs = [...document.querySelectorAll("input")];
  return inputs.find((i) => /Search any U\.S\. college/i.test(i.placeholder || "")) || null;
});
ok(!!(await box.jsonValue()) !== false && box.asElement() !== null, "search box present on Explore");
const el = box.asElement();
await el.click();
await el.type("berkeley", { delay: 25 });
await new Promise((r) => setTimeout(r, 2500));
const uiText = await page.evaluate(() => document.body.innerText);
ok(/berkeley/i.test(uiText), "typing 'berkeley' renders matching colleges in the list");
ok(/result/i.test(uiText), "result count shown");
await page.screenshot({ path: "/tmp/explore-search.png", clip: { x: 0, y: 60, width: 1400, height: 780 } });
console.log("      screenshot: /tmp/explore-search.png");

ok(errs.length === 0, `no page errors${errs.length ? " — " + errs[0] : ""}`);
await browser.close();
console.log(fail ? "\nSOME CHECKS FAILED" : "\nEXPLORE SEARCH OK");
process.exit(fail);
