// Inspects the real rendered nav in a clean headless Chrome (no extensions),
// to see which tabs actually carry an active pill background.
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "https://college-forge.vercel.app";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`${BASE}/hub/index.html`, { waitUntil: "networkidle2" });
await page.waitForSelector("nav a", { timeout: 20000 });

const readTabs = () =>
  page.$$eval("nav a", (as) =>
    as.map((a) => {
      const cs = getComputedStyle(a);
      return {
        label: a.textContent.trim(),
        bg: cs.backgroundColor,
        color: cs.color,
        ariaCurrent: a.getAttribute("aria-current"),
        inlineBg: a.style.background || a.style.backgroundColor || "(none)",
      };
    })
  );

const opaque = (bg) => bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";

console.log("=== initial (Overview should be the only active tab) ===");
let tabs = await readTabs();
for (const t of tabs) console.log(`  ${t.label.padEnd(10)} bg=${t.bg.padEnd(22)} aria=${String(t.ariaCurrent).padEnd(6)} inline=${t.inlineBg}`);
console.log("  tabs WITH a background:", tabs.filter((t) => opaque(t.bg)).map((t) => t.label).join(", ") || "(none)");

// Click Profile the way a user does.
const links = await page.$$("nav a");
for (const l of links) {
  const txt = await l.evaluate((n) => n.textContent.trim());
  if (txt === "Profile") { await l.click(); break; }
}
await new Promise((r) => setTimeout(r, 500));

console.log("\n=== after clicking Profile ===");
tabs = await readTabs();
for (const t of tabs) console.log(`  ${t.label.padEnd(10)} bg=${t.bg.padEnd(22)} aria=${String(t.ariaCurrent).padEnd(6)} inline=${t.inlineBg}`);

const withBg = tabs.filter((t) => opaque(t.bg)).map((t) => t.label);
console.log("  tabs WITH a background:", withBg.join(", ") || "(none)");

await page.screenshot({ path: "/tmp/tabs-headless.png", clip: { x: 0, y: 0, width: 1280, height: 90 } });
console.log("\nscreenshot: /tmp/tabs-headless.png");
if (errors.length) console.log("page errors:", errors.slice(0, 5));

console.log(withBg.length === 1 && withBg[0] === "Profile"
  ? "\nRESULT: only Profile is highlighted — renders correctly in a clean browser"
  : `\nRESULT: ${withBg.length} tabs highlighted (${withBg.join(", ")}) — REPRODUCED`);

await browser.close();
