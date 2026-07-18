import puppeteer from "puppeteer-core";
const BASE = process.env.BASE || "http://127.0.0.1:3210";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`${BASE}/hub/index.html`, { waitUntil: "networkidle2" });
for (const l of await page.$$("nav a")) {
  if ((await l.evaluate((n) => n.textContent.trim())) === "Explore") { await l.click(); break; }
}
await new Promise((r) => setTimeout(r, 500));
const inputs = await page.$$("input");
for (const i of inputs) {
  const ph = await i.evaluate((n) => n.placeholder || "");
  if (/Search any U\.S\. college/i.test(ph)) { await i.click(); await i.type(process.env.Q || "stanford", { delay: 20 }); break; }
}
await new Promise((r) => setTimeout(r, 3500));
// Scroll the detail panel to show programs + earnings
const off = Number(process.env.SCROLL || 0);
if (off) await page.evaluate((o) => {
  const panes = [...document.querySelectorAll("div")].filter((d) => d.scrollHeight > d.clientHeight + 50 && d.clientHeight > 300);
  if (panes.length) panes[panes.length - 1].scrollTop = o;
}, off);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: process.env.OUT || "/tmp/detail.png", clip: { x: 620, y: 380, width: 760, height: 600 } });
console.log("saved", process.env.OUT || "/tmp/detail.png");
await browser.close();
