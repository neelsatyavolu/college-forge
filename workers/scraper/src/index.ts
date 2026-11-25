/**
 * Forge's private scraper. Speaks the two Firecrawl v2 calls Forge uses (lib/firecrawl.ts):
 *   POST /v2/scrape  {url}            -> {success, data:{markdown, metadata:{title,url}}}
 * Pages are fetched plainly first; script-drawn pages fall back to Cloudflare Browser Rendering.
 * Search is not offered (Forge searches through Exa itself). Every call needs `Authorization: Bearer <SCRAPER_TOKEN>`.
 */
import puppeteer from "@cloudflare/puppeteer";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { isAllowedUrl, tokensMatch } from "./url";

type Env = {
  BROWSER: { fetch: typeof fetch };
  PAGES: { get(k: string, t: "json"): Promise<unknown>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
  SCRAPER_TOKEN: string;
};

const CACHE_TTL_S = 3 * 24 * 3600;
const MIN_TEXT = 1500;
const MAX_MARKDOWN = 120_000;
const UA = "Mozilla/5.0 (compatible; ForgeResearch/1.0; +https://forge.n3el.dev)";
const DROP = ["script", "style", "noscript", "svg", "nav", "footer", "form", "iframe", "aside"];

const BLOCKED = /^(access denied|forbidden|just a moment|attention required|403 forbidden|request rejected)/i;

const nhm = new NodeHtmlMarkdown({ ignore: DROP, maxConsecutiveNewlines: 2 }, undefined, undefined);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function toMarkdown(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  return nhm.translate(main).trim().slice(0, MAX_MARKDOWN);
}

async function plainFetch(url: string): Promise<{ html?: string; finalUrl: string; error?: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const type = res.headers.get("content-type") || "";
  if (!res.ok) return { finalUrl: res.url || url, error: `http ${res.status}` };
  if (type.includes("pdf")) return { finalUrl: res.url || url, error: "pdf" };
  if (!type.includes("html")) return { finalUrl: res.url || url, error: "not html" };
  return { html: await res.text(), finalUrl: res.url || url };
}

async function browserFetch(env: Env, url: string): Promise<string> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25_000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function scrape(env: Env, url: string) {
  if (!isAllowedUrl(url)) return json({ success: false, error: "Only public web pages can be read." }, 400);
  const cached = await env.PAGES.get(`p:${url}`, "json");
  if (cached) return json(cached);

  let plain: Awaited<ReturnType<typeof plainFetch>>;
  try {
    plain = await plainFetch(url);
  } catch {
    plain = { finalUrl: url, error: "fetch failed" };
  }
  if (plain.error === "pdf" || plain.error === "not html" || plain.error?.startsWith("http 404")) {
    return json({ success: false, error: plain.error }, 422);
  }
  let html = plain.html ?? "";
  let markdown = html && !BLOCKED.test(titleOf(html)) ? toMarkdown(html) : "";
  if (markdown.length < MIN_TEXT) {
    try {
      html = await browserFetch(env, url);
      const rendered = BLOCKED.test(titleOf(html)) ? "" : toMarkdown(html);
      if (rendered.length > markdown.length) markdown = rendered;
    } catch {
      // keep whatever the plain fetch produced
    }
  }
  if (!markdown) return json({ success: false, error: "The site blocked the request or the page has no readable content." }, 422);
  const body = { success: true, data: { markdown, metadata: { title: titleOf(html), url: plain.finalUrl, sourceURL: url } } };
  await env.PAGES.put(`p:${url}`, JSON.stringify(body), { expirationTtl: CACHE_TTL_S });
  return json(body);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!tokensMatch(token, env.SCRAPER_TOKEN || "")) return json({ success: false, error: "unauthorized" }, 401);
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ success: false, error: "bad json" }, 400);
    }
    try {
      if (pathname === "/v2/scrape" && typeof body.url === "string") return await scrape(env, body.url.trim());
    } catch (err) {
      console.error("scraper error", pathname, err instanceof Error ? err.message : err);
      return json({ success: false, error: "scraper failed" }, 500);
    }
    return json({ success: false, error: "not found" }, 404);
  },
};
