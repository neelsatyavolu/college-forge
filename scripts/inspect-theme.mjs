// Renders the hub in both themes in a clean Chrome, screenshots each, and
// checks nav highlighting + text/background contrast.
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3210";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let fail = 0;
const ok = (c, label) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}`); if (!c) fail = 1; };

const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
// WCAG relative luminance + contrast ratio.
const lum = (c) => {
  const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const contrast = (f, b) => {
  const [l1, l2] = [lum(rgb(f)), lum(rgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });

for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  // Hard-gate onboarding blocks the hub when the workspace is empty. Seed a
  // completed flag so theme checks hit the real chrome + Overview card.
  await page.evaluateOnNewDocument(() => {
    const seed = () => {
      if (!window.CF_DATA) return;
      window.CF_DATA = {
        ...window.CF_DATA,
        onboarding: { completed: true },
        applicant: { ...(window.CF_DATA.applicant || {}), name: "Theme Inspect" },
      };
    };
    // data.js assigns CF_DATA synchronously; patch after each script if needed.
    Object.defineProperty(window, "CF_DATA", {
      configurable: true,
      set(v) {
        Object.defineProperty(window, "CF_DATA", { configurable: true, writable: true, value: v });
        seed();
      },
      get() { return undefined; },
    });
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init);
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.includes("/api/workspace") && (!init || !init.method || init.method === "GET")) {
        const j = await res.clone().json().catch(() => null);
        if (j && typeof j === "object") {
          const patched = {
            ...j,
            onboarding: { ...(j.onboarding || {}), completed: true },
            applicant: { ...(j.applicant || {}), name: j.applicant?.name || "Theme Inspect" },
          };
          return new Response(JSON.stringify(patched), {
            status: res.status,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return res;
    };
  });

  await page.goto(`${BASE}/hub/index.html`, { waitUntil: "networkidle2" });
  // Hub chrome is a <header class="cf-hub-nav">, not a <nav>.
  await page.waitForSelector(".cf-hub-nav a.cf-hub-nav__tab", { timeout: 20000 });

  console.log(`\n=== prefers-color-scheme: ${scheme} ===`);
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  ok(theme === scheme, `data-theme resolves to "${scheme}" (got "${theme}")`);

  const body = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  console.log(`      body bg=${body.bg} text=${body.color}`);
  const cr = contrast(body.color, body.bg);
  console.log(`      body contrast ratio: ${cr.toFixed(2)}:1`);
  ok(cr >= 4.5, `body text meets WCAG AA (>=4.5:1)`);

  const isDarkBg = lum(rgb(body.bg)) < 0.2;
  ok(scheme === "dark" ? isDarkBg : !isDarkBg, `canvas is ${scheme}`);

  const tabSel = ".cf-hub-nav__tabs a.cf-hub-nav__tab";
  // Click Profile and confirm exactly one tab keeps a pill.
  for (const l of await page.$$(tabSel)) {
    if ((await l.evaluate((n) => n.textContent.trim())) === "Profile") { await l.click(); break; }
  }
  await new Promise((r) => setTimeout(r, 400));
  const withBg = await page.$$eval(tabSel, (as) =>
    as.filter((a) => { const b = getComputedStyle(a).backgroundColor; return b && b !== "rgba(0, 0, 0, 0)"; })
      .map((a) => a.textContent.trim())
  );
  console.log(`      tabs highlighted after clicking Profile: ${withBg.join(", ") || "(none)"}`);
  ok(withBg.length === 1 && withBg[0] === "Profile", "exactly one tab highlighted");

  // Nav text contrast in this theme.
  const navText = await page.$$eval(tabSel, (as) => {
    const cs = getComputedStyle(as[2]); // an inactive tab
    return { color: cs.color, bg: getComputedStyle(document.body).backgroundColor };
  });
  const navCr = contrast(navText.color, navText.bg);
  console.log(`      inactive nav text contrast: ${navCr.toFixed(2)}:1`);
  ok(navCr >= 4.5, "inactive nav text meets WCAG AA");

  // onColor buttons sit on dark/coral cards — must stay light text, never the
  // inverted --on-primary (near-black in dark theme).
  for (const l of await page.$$(tabSel)) {
    if ((await l.evaluate((n) => n.textContent.trim())) === "Overview") { await l.click(); break; }
  }
  await new Promise((r) => setTimeout(r, 400));
  const onColor = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((el) => /Ask the copilot/i.test(el.textContent || ""));
    if (!b) return null;
    const cs = getComputedStyle(b);
    // Walk up to the card surface behind the button.
    let p = b.parentElement;
    let bg = cs.backgroundColor;
    while (p) {
      const pbg = getComputedStyle(p).backgroundColor;
      if (pbg && pbg !== "rgba(0, 0, 0, 0)" && pbg !== "transparent") { bg = pbg; break; }
      p = p.parentElement;
    }
    return { color: cs.color, bg, text: (b.textContent || "").trim() };
  });
  if (onColor) {
    const ocr = contrast(onColor.color, onColor.bg);
    console.log(`      onColor "${onColor.text}" color=${onColor.color} on bg=${onColor.bg} → ${ocr.toFixed(2)}:1`);
    ok(ocr >= 4.5, "onColor button text meets WCAG AA on its card");
    // Text must be light (high luminance) — catches the dark-mode near-black bug.
    ok(lum(rgb(onColor.color)) > 0.5, "onColor text is light-on-dark (not inverted ink)");
  } else {
    console.log("      (no onColor 'Ask the copilot' button found — skip)");
  }

  await page.screenshot({ path: `/tmp/hub-${scheme}.png`, fullPage: false });
  ok(errs.length === 0, `no page errors${errs.length ? " — " + errs[0] : ""}`);
  await page.close();
}

await browser.close();
console.log(fail ? "\nSOME CHECKS FAILED" : "\nBOTH THEMES OK");
process.exit(fail);
