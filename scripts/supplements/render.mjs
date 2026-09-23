/**
 * Headless-Chrome fallback for admissions sites that render client-side
 * (the static HTML has no links or prompt text). Launched lazily, only when
 * a page needs it. Chrome comes from CHROME_PATH or a standard install
 * location; without one, rendering is skipped and the static HTML is used.
 */

import { existsSync } from "node:fs";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);
const NAV_TIMEOUT_MS = 30_000;
const MIN_LINKS = 5;

/** True when static HTML looks like an empty client-rendered shell. */
export function needsRender(html) {
  return (html.match(/<a\s[^>]*href=/gi) || []).length < MIN_LINKS;
}

export function createRenderer({ userAgent } = {}) {
  let launching = null; // Promise<Browser | null>, shared by concurrent callers
  let unavailable = false;

  async function launch() {
    const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
    if (!executablePath) {
      unavailable = true;
      return null;
    }
    const { default: puppeteer } = await import("puppeteer-core");
    return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  }

  /** Rendered HTML for a URL, or null when Chrome is unavailable or navigation fails. */
  async function render(url) {
    if (unavailable) return null;
    try {
      launching ??= launch();
      const b = await launching;
      if (!b) return null;
      const page = await b.newPage();
      try {
        if (userAgent) await page.setUserAgent(userAgent);
        await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
        return await page.content();
      } finally {
        await page.close();
      }
    } catch {
      return null;
    }
  }

  async function close() {
    const b = launching && (await launching.catch(() => null));
    launching = null;
    if (b) await b.close();
  }

  return { render, close };
}
