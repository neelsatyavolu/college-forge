// Exercises the copilot's connect gating + OAuth start in a real browser.
// Stops short of completing OAuth (that needs a human login).
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3210";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let fail = 0;
const ok = (c, label) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fail = 1; };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(`${BASE}/hub/index.html`, { waitUntil: "networkidle2" });

// status must be uncacheable — a stale "connected" is what let a send through.
const statusHeaders = await page.evaluate(async () => {
  const r = await fetch("/api/ai/status", { cache: "no-store" });
  return { cc: r.headers.get("cache-control"), body: await r.json() };
});
console.log(`      /api/ai/status cache-control: ${statusHeaders.cc}`);
ok(/no-store/.test(statusHeaders.cc || ""), "status is no-store (can't cache a stale session)");
ok(statusHeaders.body.active === null, "no provider connected (expected for a fresh browser)");

// Open the copilot.
await page.click('button[aria-label="Open copilot"]').catch(() => {});
await new Promise((r) => setTimeout(r, 600));

const panelText = await page.evaluate(() => document.body.innerText);
ok(/Connect an AI to power the copilot/i.test(panelText), "connect panel shown when no provider");
ok(/Connect Grok/i.test(panelText) && /Connect ChatGPT/i.test(panelText), "both provider buttons offered");

// Composer must be disabled while disconnected.
const composer = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input")].filter((i) => i.type !== "file");
  const box = inputs.find((i) => /Connect an AI|Ask, or upload/i.test(i.placeholder || ""));
  return box ? { placeholder: box.placeholder, disabled: box.disabled } : null;
});
console.log(`      composer: "${composer?.placeholder}" disabled=${composer?.disabled}`);
ok(composer?.disabled === true, "composer disabled while disconnected");

// Clicking "Connect Grok" must hit /api/auth/grok/start and return a real authorize URL.
const startRes = await page.evaluate(async () => {
  const r = await fetch("/api/auth/grok/start", { method: "POST" });
  return { status: r.status, body: await r.json() };
});
console.log(`      /api/auth/grok/start -> ${startRes.status}`);
ok(startRes.status === 200 && typeof startRes.body.authorizeUrl === "string", "grok start returns an authorize URL");
ok(/^https:\/\/auth\.x\.ai\/oauth2\/authorize\?/.test(startRes.body.authorizeUrl || ""), "authorize URL points at auth.x.ai");
ok(/code_challenge=/.test(startRes.body.authorizeUrl || ""), "PKCE challenge present");

const codexStart = await page.evaluate(async () => {
  const r = await fetch("/api/auth/codex/start", { method: "POST" });
  return { status: r.status, body: await r.json() };
});
ok(codexStart.status === 200 && typeof codexStart.body.authorizeUrl === "string", "codex start returns an authorize URL");
console.log(`      codex authorize host: ${(codexStart.body.authorizeUrl || "").split("/")[2]}`);

// A bad callback must be rejected cleanly, not 500.
const bad = await page.evaluate(async () => {
  const r = await fetch("/api/auth/grok/complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback: "not-a-url" }),
  });
  return { status: r.status, body: await r.json() };
});
console.log(`      bad callback -> ${bad.status}: ${bad.body.error}`);
ok(bad.status >= 400 && !!bad.body.error, "bad callback rejected with an error message (no crash)");

ok(errs.length === 0, `no page errors${errs.length ? " — " + errs[0] : ""}`);
await browser.close();
console.log(fail ? "\nSOME CHECKS FAILED" : "\nCONNECT FLOW OK");
process.exit(fail);
